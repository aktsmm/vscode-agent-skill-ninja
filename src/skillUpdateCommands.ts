import * as path from "path";
import * as vscode from "vscode";
import { isJapanese, messages } from "./i18n";
import type { Skill, SkillIndex } from "./skillIndex";
import type { SkillRoot } from "./skillLocations";
import {
  installSkill,
  installSkillUpdate,
  classifySkillInstallFailure,
  SkillInstallIncompleteError,
  resolveManagedSkillDirUri,
  resolveSkillFolderName,
  resolveSkillDownloadTarget,
  type SkillMeta,
} from "./skillInstaller";
import {
  classifySkillUpdate,
  createSkillRevisionResolver,
  findRenamedSkillRevision,
  SkillSourcePathMissingError,
  type SkillSourceRevision,
} from "./skillUpdates";
import { resolveCurrentSkillRoot } from "./treeProvider";

export interface SkillUpdateEntry {
  meta: SkillMeta;
  skill?: Skill;
  workspaceUri: vscode.Uri;
}

export interface SkillUpdateCommandDependencies {
  context: vscode.ExtensionContext;
  getRoots(): Promise<SkillRoot[]>;
  getIndex(): Promise<SkillIndex>;
  getEntries(root: SkillRoot, index: SkillIndex): Promise<SkillUpdateEntry[]>;
  getToken(): Promise<string | undefined>;
  afterUpdate(roots: SkillRoot[]): Promise<void>;
}

export interface SkillUpdateSummary {
  updated: number;
  synchronized: number;
  unchanged: number;
  untracked: number;
  repairNeeded: number;
  checkFailed: number;
  updateFailed: number;
  deferred: number;
  cancelled: boolean;
}

type RootItem = Parameters<typeof resolveCurrentSkillRoot>[0];
type Candidate = SkillUpdateEntry & { root: SkillRoot; destination: string };
type Planned = Candidate & {
  revision: SkillSourceRevision;
  state: "changed" | "untracked";
};
type RenameOffer = SkillUpdateEntry & {
  root: SkillRoot;
  name: string;
  revision: SkillSourceRevision;
};

const text = (english: string, japanese: string) =>
  isJapanese() ? japanese : english;

function matchesSourceRepository(
  sourceUrl: string | undefined,
  revision: SkillSourceRevision,
): boolean {
  if (!sourceUrl) return false;
  try {
    const url = new URL(sourceUrl);
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      owner?.toLowerCase() === revision.owner.toLowerCase() &&
      repo?.replace(/\.git$/i, "").toLowerCase() === revision.repo.toLowerCase()
    );
  } catch {
    return false;
  }
}

export function registerSkillUpdateCommands(
  deps: SkillUpdateCommandDependencies,
): vscode.Disposable[] {
  let running = false;
  let detailsChannel: vscode.OutputChannel | undefined;

  async function run(
    all: boolean,
    item?: RootItem,
  ): Promise<SkillUpdateSummary | undefined> {
    if (running) {
      void vscode.window.showInformationMessage(
        text(
          "A skill update is already running.",
          "スキル更新は既に実行中です。",
        ),
      );
      return;
    }
    running = true;
    const summary: SkillUpdateSummary = {
      updated: 0,
      synchronized: 0,
      unchanged: 0,
      untracked: 0,
      repairNeeded: 0,
      checkFailed: 0,
      updateFailed: 0,
      deferred: 0,
      cancelled: false,
    };
    const modified = new Map<string, SkillRoot>();
    const failures = new Map<string, number>();
    const details: string[] = [];
    const renameOffers: RenameOffer[] = [];
    let missingUpstream = false;
    let token: string | undefined;
    let tokenLoaded = false;
    let resolveUnindexed:
      | ReturnType<typeof createSkillRevisionResolver>
      | undefined;
    const getToken = async () => {
      if (!tokenLoaded) {
        token = await deps.getToken();
        tokenLoaded = true;
      }
      return token;
    };
    const label = (entry: SkillUpdateEntry) =>
      (
        entry.meta.name ||
        entry.meta.relativePath ||
        entry.meta.remotePath ||
        text("unnamed skill", "名前のないスキル")
      )
        .replace(/\p{Cc}/gu, " ")
        .slice(0, 120);
    const note = (entry: SkillUpdateEntry, reason: string) => {
      details.push(`${label(entry)}: ${reason}`);
    };
    const defer = (entries: readonly SkillUpdateEntry[], reason: string) => {
      summary.deferred += entries.length;
      for (const entry of entries) {
        note(entry, reason);
      }
    };
    const recordFailure = (
      stage: "check" | "update" | "refresh",
      error?: unknown,
      reportedKinds?: readonly string[],
    ) => {
      const kinds = reportedKinds?.length
        ? reportedKinds
        : error instanceof SkillInstallIncompleteError && error.failures.length
          ? error.failures.map((failure) => failure.kind)
          : [classifySkillInstallFailure(error)];
      for (const candidate of new Set(kinds)) {
        const kind = [
          "rate-limit",
          "sso-required",
          "classic-pat-forbidden",
          "auth-required",
          "not-found",
          "server-error",
          "transport",
          "filesystem",
          "policy-limit",
          "cancelled",
          "other",
        ].includes(candidate)
          ? candidate
          : "other";
        const key = `${stage}:${kind}`;
        failures.set(key, Math.min((failures.get(key) ?? 0) + 1, 999999));
      }
    };
    const offerRename = async (
      entry: SkillUpdateEntry,
      root: SkillRoot,
      index: SkillIndex,
      signal: AbortSignal,
    ): Promise<boolean> => {
      const previous = entry.meta.sourceRevision;
      const source = index.sources.find(
        (candidate) => candidate.id === entry.meta.source,
      );
      if (
        previous?.kind !== "tree" ||
        previous.remotePath !== entry.meta.remotePath ||
        !matchesSourceRepository(source?.url, previous)
      ) {
        return false;
      }
      try {
        const revision = await findRenamedSkillRevision(
          previous,
          await getToken(),
          signal,
        );
        if (signal.aborted) return false;
        const name = revision?.remotePath.split("/").at(-1);
        if (
          revision &&
          name &&
          /^[a-zA-Z0-9_.-]+$/.test(name) &&
          name !== entry.meta.name
        ) {
          const oldTarget = resolveManagedSkillDirUri(
            root.rootUri,
            entry.meta.relativePath || "",
          );
          const newTarget = resolveManagedSkillDirUri(
            root.rootUri,
            resolveSkillFolderName({
              name,
              source: entry.meta.source,
              path: revision.remotePath,
            }),
          );
          const normalize = (value: string) =>
            process.platform === "win32" ? value.toLowerCase() : value;
          if (normalize(oldTarget.fsPath) === normalize(newTarget.fsPath)) {
            defer(
              [entry],
              text(
                "renamed upstream, but the new install would replace the old copy",
                "配布元で名前が変わりましたが、旧コピーを上書きするため保留しました",
              ),
            );
            return true;
          }
          try {
            await vscode.workspace.fs.stat(newTarget);
            defer(
              [entry],
              text(
                `renamed upstream to ${name}, which is already installed`,
                `配布元で ${name} に名前が変わりましたが、インストール済みです`,
              ),
            );
            return true;
          } catch (error) {
            if (
              !(error instanceof vscode.FileSystemError) ||
              error.code !== "FileNotFound"
            ) {
              throw error;
            }
          }
          if (signal.aborted) return false;
          renameOffers.push({ ...entry, root, name, revision });
          defer(
            [entry],
            text(
              `renamed upstream to ${name}; install the new skill separately`,
              `配布元で ${name} に名前が変わりました。新しいスキルを別途インストールできます`,
            ),
          );
          return true;
        }
      } catch (error) {
        if (!signal.aborted) {
          summary.checkFailed++;
          recordFailure("check", error);
          note(entry, text("rename lookup failed", "名前変更の確認に失敗"));
        }
      }
      return false;
    };
    try {
      const currentRoots = await deps.getRoots();
      const selected = all
        ? currentRoots
        : [resolveCurrentSkillRoot(item, currentRoots)].filter(
            (root): root is SkillRoot => !!root,
          );
      const roots = selected.filter(
        (root) =>
          root.isManaged && !root.isReadOnly && root.rootUri.scheme === "file",
      );
      if (!roots.length) {
        void vscode.window.showWarningMessage(
          text(
            "No current writable skill root was resolved. Select a managed root and try again.",
            "現在の書き込み可能なスキルルートを特定できません。管理対象ルートを選択して再実行してください。",
          ),
        );
        return summary;
      }
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: text("Update changed skills", "変更されたスキルを更新"),
          cancellable: true,
        },
        async (progress, cancellation) => {
          const abort = new AbortController();
          const listener = cancellation.onCancellationRequested(() =>
            abort.abort(),
          );
          if (cancellation.isCancellationRequested) {
            abort.abort();
          }
          const active = () => !abort.signal.aborted;
          try {
            progress.report({
              message: text(
                "Reading installed skills...",
                "インストール済みスキルを確認中...",
              ),
            });
            const index = await deps.getIndex();
            if (!active()) {
              summary.cancelled = true;
              return;
            }
            const candidates: Candidate[] = [];
            const seen = new Set<string>();
            for (const [rootPosition, root] of roots.entries()) {
              if (!active()) {
                summary.cancelled = true;
                defer(candidates, text("cancelled", "中断"));
                return;
              }
              progress.report({
                message: text(
                  `Scanning skill roots (${rootPosition + 1}/${roots.length})`,
                  `スキルルートを確認中 (${rootPosition + 1}/${roots.length})`,
                ),
              });
              const rootKey = root.rootUri.toString();
              if (seen.has(rootKey)) continue;
              seen.add(rootKey);
              try {
                const entries = await deps.getEntries(root, index);
                if (!active()) {
                  summary.cancelled = true;
                  defer([...candidates, ...entries], text("cancelled", "中断"));
                  return;
                }
                for (const entry of entries) {
                  if (entry.meta.incomplete || entry.meta.repairState) {
                    summary.repairNeeded++;
                    note(
                      entry,
                      text(
                        "needs repair; use forced reinstall",
                        "要修復。強制再インストールを使用してください",
                      ),
                    );
                    continue;
                  }
                  if (entry.meta.reinstallDisabled) {
                    defer(
                      [entry],
                      text("reinstall disabled", "再インストールが無効"),
                    );
                    continue;
                  }
                  if (!entry.meta.remotePath || !entry.meta.relativePath) {
                    defer(
                      [entry],
                      text(
                        "no upstream or install path",
                        "配布元またはインストール先のパスがありません",
                      ),
                    );
                    continue;
                  }
                  if (!entry.skill) {
                    const previous = entry.meta.sourceRevision;
                    const source = index.sources.find(
                      (candidate) => candidate.id === entry.meta.source,
                    );
                    if (
                      previous &&
                      previous.remotePath === entry.meta.remotePath &&
                      matchesSourceRepository(source?.url, previous)
                    ) {
                      try {
                        resolveUnindexed ??= createSkillRevisionResolver(
                          await getToken(),
                          abort.signal,
                        );
                        const current = await resolveUnindexed({
                          owner: previous.owner,
                          repo: previous.repo,
                          branch: previous.ref,
                          remotePath: previous.remotePath,
                        });
                        if (!active()) {
                          summary.cancelled = true;
                          defer(
                            [...candidates, entry],
                            text("cancelled", "中断"),
                          );
                          return;
                        }
                        if (
                          classifySkillUpdate(entry.meta, current) ===
                          "unchanged"
                        ) {
                          summary.unchanged++;
                        } else {
                          defer(
                            [entry],
                            text(
                              "source path exists, but is not in the index; refresh the source index before updating",
                              "配布元のパスは存在しますが索引にありません。更新前にソース索引を更新してください",
                            ),
                          );
                        }
                        continue;
                      } catch (error) {
                        if (!active()) {
                          summary.cancelled = true;
                          defer(
                            [...candidates, entry],
                            text("cancelled", "中断"),
                          );
                          return;
                        }
                        if (!(error instanceof SkillSourcePathMissingError)) {
                          summary.checkFailed++;
                          recordFailure("check", error);
                          note(
                            entry,
                            text("source check failed", "配布元の確認に失敗"),
                          );
                          continue;
                        }
                      }
                    }
                    missingUpstream = true;
                    if (await offerRename(entry, root, index, abort.signal)) {
                      continue;
                    }
                    if (!active()) {
                      summary.cancelled = true;
                      defer([...candidates, entry], text("cancelled", "中断"));
                      return;
                    }
                    defer(
                      [entry],
                      text(
                        "missing upstream entry (removed or renamed); find the new source path",
                        "配布元の項目が見つかりません（削除または名前変更の可能性）。新しい配布元パスを確認してください",
                      ),
                    );
                    continue;
                  }
                  try {
                    const destination = resolveManagedSkillDirUri(
                      root.rootUri,
                      entry.meta.relativePath,
                    ).fsPath;
                    candidates.push({
                      ...entry,
                      root,
                      destination:
                        process.platform === "win32"
                          ? destination.toLowerCase()
                          : destination,
                    });
                  } catch {
                    defer(
                      [entry],
                      text(
                        "invalid install path",
                        "インストール先のパスが無効",
                      ),
                    );
                  }
                }
              } catch (error) {
                if (!active()) {
                  summary.cancelled = true;
                  defer(candidates, text("cancelled", "中断"));
                  return;
                }
                summary.checkFailed++;
                recordFailure("check", error);
                details.push(
                  `${root.rootPath.replace(/\p{Cc}/gu, " ").slice(0, 120)}: ${text("skill root scan failed", "スキルルートの確認に失敗")}`,
                );
              }
            }
            if (!active()) {
              summary.cancelled = true;
              defer(candidates, text("cancelled", "中断"));
              return;
            }
            if (candidates.length === 0) {
              return;
            }
            const token = await getToken();
            const resolveRevision = createSkillRevisionResolver(
              token,
              abort.signal,
            );
            const overlaps = (left: string, right: string) => {
              const relative = path.relative(left, right);
              return (
                relative === "" ||
                (!relative.startsWith(`..${path.sep}`) &&
                  relative !== ".." &&
                  !path.isAbsolute(relative))
              );
            };
            const planned: Planned[] = [];
            for (const [position, candidate] of candidates.entries()) {
              if (!active()) {
                summary.cancelled = true;
                defer(
                  [...planned, ...candidates.slice(position)],
                  text("cancelled", "中断"),
                );
                return;
              }
              progress.report({
                message: text(
                  `Checking updates (${position + 1}/${candidates.length})`,
                  `更新の有無を確認中 (${position + 1}/${candidates.length})`,
                ),
              });
              if (
                candidates.some(
                  (other) =>
                    other !== candidate &&
                    (overlaps(candidate.destination, other.destination) ||
                      overlaps(other.destination, candidate.destination)),
                )
              ) {
                defer(
                  [candidate],
                  text("overlapping install paths", "インストール先が重複"),
                );
                continue;
              }
              try {
                const skill = candidate.skill!;
                if (skill.path !== candidate.meta.remotePath) {
                  missingUpstream = true;
                  if (
                    await offerRename(
                      candidate,
                      candidate.root,
                      index,
                      abort.signal,
                    )
                  ) {
                    continue;
                  }
                  if (!active()) {
                    summary.cancelled = true;
                    defer(
                      [...planned, ...candidates.slice(position)],
                      text("cancelled", "中断"),
                    );
                    return;
                  }
                  defer(
                    [candidate],
                    text(
                      "indexed source path changed; verify the new skill",
                      "索引の配布元パスが変わりました。新しいスキルを確認してください",
                    ),
                  );
                  continue;
                }
                const target = await resolveSkillDownloadTarget(
                  skill,
                  index.sources.find((source) => source.id === skill.source),
                  token,
                  abort.signal,
                );
                if (!target) {
                  defer(
                    [candidate],
                    text(
                      "source download target unavailable",
                      "配布元の取得先が見つかりません",
                    ),
                  );
                  continue;
                }
                const revision = await resolveRevision(target);
                const state = classifySkillUpdate(candidate.meta, revision);
                if (state === "unchanged") {
                  summary.unchanged++;
                } else if (state === "repair") {
                  summary.repairNeeded++;
                  note(
                    candidate,
                    text(
                      "needs repair; use forced reinstall",
                      "要修復。強制再インストールを使用してください",
                    ),
                  );
                } else {
                  if (state === "untracked") {
                    summary.untracked++;
                  }
                  planned.push({ ...candidate, revision, state });
                }
              } catch (error) {
                if (!active()) {
                  summary.cancelled = true;
                  defer(
                    [...planned, ...candidates.slice(position)],
                    text("cancelled", "中断"),
                  );
                  return;
                }
                if (error instanceof SkillSourcePathMissingError) {
                  missingUpstream = true;
                  if (
                    await offerRename(
                      candidate,
                      candidate.root,
                      index,
                      abort.signal,
                    )
                  ) {
                    continue;
                  }
                  if (!active()) {
                    summary.cancelled = true;
                    defer(
                      [...planned, ...candidates.slice(position)],
                      text("cancelled", "中断"),
                    );
                    return;
                  }
                  defer(
                    [candidate],
                    text(
                      "missing upstream entry (removed or renamed); find the new source path",
                      "配布元の項目が見つかりません（削除または名前変更の可能性）。新しい配布元パスを確認してください",
                    ),
                  );
                  continue;
                }
                summary.checkFailed++;
                recordFailure("check", error);
                note(candidate, text("check failed", "確認失敗"));
              }
            }
            if (!active()) {
              summary.cancelled = true;
              defer(planned, text("cancelled", "中断"));
              return;
            }
            if (!planned.length) {
              return;
            }
            const changed = planned.filter(
              (entry) => entry.state === "changed",
            ).length;
            const changedOnly = text("Update changed only", "変更分のみ更新");
            const includeLegacy = text(
              "Update and sync legacy",
              "更新と初回同期",
            );
            const confirmation = text(
              `Upstream changed: ${changed}. No comparison baseline: ${summary.untracked}. Selected skills will overwrite local edits. Legacy sync may overwrite skills whose upstream has not changed. Unchanged skills are preserved.`,
              `配布元の変更: ${changed} 件。比較情報なし: ${summary.untracked} 件。対象スキルのローカル編集は上書きされます。初回同期は配布元が未変更のスキルも上書きする可能性があります。変更なしのスキルは保持します。`,
            );
            const choices = summary.untracked
              ? changed
                ? [changedOnly, includeLegacy]
                : [includeLegacy]
              : [changedOnly];
            const choice = await vscode.window.showWarningMessage(
              confirmation,
              { modal: true },
              ...choices,
            );
            if (!active() || !choice) {
              summary.cancelled = true;
              defer(
                planned,
                text("update not confirmed", "更新が確認されませんでした"),
              );
              return;
            }
            const accepted = planned.filter(
              (entry) => entry.state === "changed" || choice === includeLegacy,
            );
            defer(
              planned.filter(
                (entry) =>
                  entry.state === "untracked" && choice !== includeLegacy,
              ),
              text("first sync not selected", "初回同期が選択されませんでした"),
            );
            for (const [position, entry] of accepted.entries()) {
              if (!active()) {
                summary.cancelled = true;
                defer(accepted.slice(position), text("cancelled", "中断"));
                break;
              }
              progress.report({
                message: text(
                  `Updating skills (${position + 1}/${accepted.length})`,
                  `スキルを更新中 (${position + 1}/${accepted.length})`,
                ),
              });
              try {
                const root = resolveCurrentSkillRoot(
                  { skillRoot: entry.root },
                  await deps.getRoots(),
                );
                if (
                  !root ||
                  !root.isManaged ||
                  root.isReadOnly ||
                  root.rootUri.scheme !== "file"
                ) {
                  defer(
                    [entry],
                    text(
                      "install root no longer writable",
                      "インストール先に書き込めなくなりました",
                    ),
                  );
                  continue;
                }
                const result = await installSkillUpdate(
                  entry.skill!,
                  entry.workspaceUri,
                  deps.context,
                  root,
                  entry.meta,
                  entry.revision,
                  { signal: abort.signal, isCancelled: () => !active() },
                );
                if (result.status !== "ok") {
                  summary.updateFailed++;
                  recordFailure(
                    "update",
                    undefined,
                    result.failures?.map((failure) => failure.kind),
                  );
                  note(entry, text("update failed", "更新失敗"));
                  continue;
                }
                if (entry.state === "untracked") {
                  summary.synchronized++;
                } else {
                  summary.updated++;
                }
                modified.set(root.rootUri.toString(), root);
              } catch (error) {
                if (!active()) {
                  summary.cancelled = true;
                  defer(accepted.slice(position), text("cancelled", "中断"));
                  break;
                }
                summary.updateFailed++;
                recordFailure("update", error);
                note(entry, text("update failed", "更新失敗"));
              }
            }
          } finally {
            listener.dispose();
          }
        },
      );
    } catch (error) {
      summary.checkFailed++;
      recordFailure("check", error);
      details.push(
        text("Skill update setup: check failed", "スキル更新の準備に失敗"),
      );
    } finally {
      if (modified.size) {
        try {
          await deps.afterUpdate([...modified.values()]);
        } catch (error) {
          recordFailure("refresh", error);
          details.push(text("View refresh failed", "表示の更新に失敗"));
          void vscode.window.showWarningMessage(
            text(
              "Skills were updated, but view/instruction refresh failed. Regenerate skill output.",
              "スキルは更新されましたが表示・出力更新に失敗しました。スキル出力を再生成してください。",
            ),
          );
        }
      }
      running = false;
    }
    const summaryMessage = text(
      `Skill update: updated ${summary.updated}, first sync ${summary.synchronized}, unchanged ${summary.unchanged}, no baseline ${summary.untracked}, needs repair ${summary.repairNeeded}, check failed ${summary.checkFailed}, update failed ${summary.updateFailed}, deferred ${summary.deferred}, cancelled ${summary.cancelled ? "yes" : "no"}.`,
      `スキル更新: 更新 ${summary.updated}、初回同期 ${summary.synchronized}、変更なし ${summary.unchanged}、比較情報なし ${summary.untracked}、要修復 ${summary.repairNeeded}、確認失敗 ${summary.checkFailed}、更新失敗 ${summary.updateFailed}、保留 ${summary.deferred}、中断 ${summary.cancelled ? "あり" : "なし"}。`,
    );
    const message = summaryMessage + (details.length ? ` ${details[0]}` : "");
    const showDetails = text("Show details", "詳細を表示");
    const openDetails = () => {
      if (!detailsChannel) {
        detailsChannel = vscode.window.createOutputChannel(
          "Agent Skills Ninja Skill Updates",
        );
        deps.context.subscriptions.push(detailsChannel);
      }
      detailsChannel.clear();
      detailsChannel.appendLine(summaryMessage);
      for (const detail of details) {
        detailsChannel.appendLine(detail);
      }
      detailsChannel.show(true);
    };
    const installRenamed = async () => {
      const offer =
        renameOffers.length === 1
          ? renameOffers[0]
          : (
              await vscode.window.showQuickPick(
                renameOffers.map((candidate) => ({
                  label: candidate.name,
                  description: `${label(candidate)} (${candidate.revision.owner}/${candidate.revision.repo})`,
                  candidate,
                })),
                {
                  placeHolder: text(
                    "Select a renamed skill",
                    "名前が変わったスキルを選択",
                  ),
                },
              )
            )?.candidate;
      if (!offer) return;
      const installAction = text(
        "Install new skill",
        "新しいスキルをインストール",
      );
      const approval = await vscode.window.showWarningMessage(
        text(
          `Upstream renamed ${label(offer)} to ${offer.name} (${offer.revision.owner}/${offer.revision.repo}@${offer.revision.commitSha.slice(0, 7)}). Install ${offer.name} as a separate skill? The old copy will remain unchanged.`,
          `配布元で ${label(offer)} は ${offer.name} に名前が変わりました (${offer.revision.owner}/${offer.revision.repo}@${offer.revision.commitSha.slice(0, 7)})。新しいスキルを別途インストールしますか？旧コピーは残ります。`,
        ),
        { modal: true },
        installAction,
      );
      if (approval !== installAction) return;
      if (running) {
        void vscode.window.showWarningMessage(
          text(
            "A skill update is already running.",
            "スキル更新は既に実行中です。",
          ),
        );
        return;
      }
      running = true;
      try {
        const root = resolveCurrentSkillRoot(
          { skillRoot: offer.root },
          await deps.getRoots(),
        );
        if (
          !root ||
          !root.isManaged ||
          root.isReadOnly ||
          root.rootUri.scheme !== "file"
        ) {
          throw new Error("Skill root is no longer writable");
        }
        const renamedSkill: Skill = {
          name: offer.name,
          source: offer.meta.source,
          path: offer.revision.remotePath,
          categories: offer.meta.categories || [],
          description: offer.meta.description || offer.name,
        };
        const oldTarget = resolveManagedSkillDirUri(
          root.rootUri,
          offer.meta.relativePath || "",
        );
        const newTarget = resolveManagedSkillDirUri(
          root.rootUri,
          resolveSkillFolderName(renamedSkill),
        );
        const normalize = (value: string) =>
          process.platform === "win32" ? value.toLowerCase() : value;
        if (normalize(oldTarget.fsPath) === normalize(newTarget.fsPath)) {
          void vscode.window.showWarningMessage(
            text(
              "The new skill would replace the old copy. Installation was skipped.",
              "新しいスキルが旧コピーを上書きするため、インストールを中止しました。",
            ),
          );
          return;
        }
        try {
          await vscode.workspace.fs.stat(newTarget);
          void vscode.window.showWarningMessage(
            text(
              `${offer.name} is already installed. Installation was skipped.`,
              `${offer.name} は既に存在するため、インストールを中止しました。`,
            ),
          );
          return;
        } catch (error) {
          if (
            !(error instanceof vscode.FileSystemError) ||
            error.code !== "FileNotFound"
          ) {
            throw error;
          }
        }
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: text(
              `Installing ${offer.name}`,
              `${offer.name} をインストール中`,
            ),
          },
          () =>
            installSkill(renamedSkill, offer.workspaceUri, deps.context, root, {
              downloadTarget: {
                owner: offer.revision.owner,
                repo: offer.revision.repo,
                branch: offer.revision.ref,
                remotePath: offer.revision.remotePath,
              },
              sourceRevision: offer.revision,
            }),
        );
        try {
          await deps.afterUpdate([root]);
        } catch {
          void vscode.window.showWarningMessage(
            result.status === "ok"
              ? text(
                  `${offer.name} installed, but view/instruction refresh failed. Regenerate skill output.`,
                  `${offer.name} をインストールしましたが表示・出力更新に失敗しました。スキル出力を再生成してください。`,
                )
              : text(
                  `${offer.name} installation is incomplete and view/instruction refresh failed. Check installation details and regenerate skill output.`,
                  `${offer.name} のインストールは不完全で、表示・出力更新にも失敗しました。インストール結果を確認し、スキル出力を再生成してください。`,
                ),
          );
          return;
        }
        if (result.status === "ok") {
          void vscode.window.showInformationMessage(
            text(
              `${offer.name} installed; ${label(offer)} was preserved.`,
              `${offer.name} をインストールしました。${label(offer)} は残しています。`,
            ),
          );
        }
      } catch {
        void vscode.window.showWarningMessage(
          text(
            `Could not install ${offer.name}. The old copy was preserved.`,
            `${offer.name} をインストールできませんでした。旧コピーは保持しています。`,
          ),
        );
      } finally {
        running = false;
      }
    };
    const installAction = text(
      "Install renamed skill",
      "名前が変わったスキルを導入",
    );
    if (failures.size || summary.repairNeeded || missingUpstream) {
      const report = messages.actionReportBug();
      const diagnostics = `Skill update failures\n${[...failures]
        .map(([kind, count]) => `${kind}=${count}`)
        .join("\n")}`;
      void vscode.window
        .showWarningMessage(
          message,
          ...(failures.size ? [report] : []),
          ...(details.length ? [showDetails] : []),
          ...(renameOffers.length ? [installAction] : []),
        )
        .then(
          (choice) => {
            if (failures.size && choice === report) {
              return vscode.commands.executeCommand(
                "skillNinja.reportBug",
                diagnostics,
              );
            }
            if (choice === showDetails) {
              openDetails();
            }
            if (choice === installAction) {
              return installRenamed();
            }
          },
          () => undefined,
        )
        .then(undefined, () => undefined);
    } else {
      void vscode.window
        .showInformationMessage(
          message,
          ...(details.length ? [showDetails] : []),
          ...(renameOffers.length ? [installAction] : []),
        )
        .then(
          (choice) => {
            if (choice === showDetails) {
              openDetails();
            }
            if (choice === installAction) {
              return installRenamed();
            }
          },
          () => undefined,
        );
    }
    return summary;
  }

  return [
    vscode.commands.registerCommand(
      "skillNinja.updateRoot",
      (item?: RootItem) => run(false, item),
    ),
    vscode.commands.registerCommand("skillNinja.updateAll", () => run(true)),
  ];
}
