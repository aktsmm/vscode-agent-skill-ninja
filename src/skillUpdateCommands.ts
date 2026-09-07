import * as path from "path";
import * as vscode from "vscode";
import { isJapanese, messages } from "./i18n";
import type { Skill, SkillIndex } from "./skillIndex";
import type { SkillRoot } from "./skillLocations";
import {
  installSkillUpdate,
  classifySkillInstallFailure,
  SkillInstallIncompleteError,
  resolveManagedSkillDirUri,
  resolveSkillDownloadTarget,
  type SkillMeta,
} from "./skillInstaller";
import {
  classifySkillUpdate,
  createSkillRevisionResolver,
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

const text = (english: string, japanese: string) =>
  isJapanese() ? japanese : english;

export function registerSkillUpdateCommands(
  deps: SkillUpdateCommandDependencies,
): vscode.Disposable[] {
  let running = false;

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
                summary.deferred += candidates.length;
                return;
              }
              progress.report({
                message: text(
                  `Scanning skill roots (${rootPosition + 1}/${roots.length})`,
                  `スキルルートを確認中 (${rootPosition + 1}/${roots.length})`,
                ),
              });
              const rootKey = root.rootUri.toString();
              if (seen.has(rootKey)) {
                continue;
              }
              seen.add(rootKey);
              try {
                for (const entry of await deps.getEntries(root, index)) {
                  if (entry.meta.incomplete || entry.meta.repairState) {
                    summary.repairNeeded++;
                    continue;
                  }
                  if (
                    !entry.skill ||
                    !entry.meta.remotePath ||
                    !entry.meta.relativePath ||
                    entry.meta.reinstallDisabled
                  ) {
                    summary.deferred++;
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
                    summary.deferred++;
                  }
                }
              } catch (error) {
                if (!active()) {
                  summary.cancelled = true;
                  summary.deferred += candidates.length;
                  return;
                }
                summary.checkFailed++;
                recordFailure("check", error);
              }
            }
            if (!active()) {
              summary.cancelled = true;
              summary.deferred += candidates.length;
              return;
            }
            if (candidates.length === 0) {
              return;
            }
            const token = await deps.getToken();
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
                summary.deferred +=
                  planned.length + candidates.length - position;
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
                summary.deferred++;
                continue;
              }
              try {
                const skill = candidate.skill!;
                const target = await resolveSkillDownloadTarget(
                  skill,
                  index.sources.find((source) => source.id === skill.source),
                  token,
                  abort.signal,
                );
                if (!target) {
                  summary.deferred++;
                  continue;
                }
                const revision = await resolveRevision(target);
                const state = classifySkillUpdate(candidate.meta, revision);
                if (state === "unchanged") {
                  summary.unchanged++;
                } else if (state === "repair") {
                  summary.repairNeeded++;
                } else {
                  if (state === "untracked") {
                    summary.untracked++;
                  }
                  planned.push({ ...candidate, revision, state });
                }
              } catch (error) {
                if (!active()) {
                  summary.cancelled = true;
                  summary.deferred +=
                    planned.length + candidates.length - position;
                  return;
                }
                summary.checkFailed++;
                recordFailure("check", error);
              }
            }
            if (!active()) {
              summary.cancelled = true;
              summary.deferred += planned.length;
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
              summary.deferred += planned.length;
              return;
            }
            const accepted = planned.filter(
              (entry) => entry.state === "changed" || choice === includeLegacy,
            );
            summary.deferred += planned.length - accepted.length;
            for (const [position, entry] of accepted.entries()) {
              if (!active()) {
                summary.cancelled = true;
                summary.deferred += accepted.length - position;
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
                  summary.deferred++;
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
                  summary.deferred += accepted.length - position;
                  break;
                }
                summary.updateFailed++;
                recordFailure("update", error);
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
    } finally {
      if (modified.size) {
        try {
          await deps.afterUpdate([...modified.values()]);
        } catch (error) {
          recordFailure("refresh", error);
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
    const message = text(
      `Skill update: updated ${summary.updated}, first sync ${summary.synchronized}, unchanged ${summary.unchanged}, no baseline ${summary.untracked}, needs repair ${summary.repairNeeded}, check failed ${summary.checkFailed}, update failed ${summary.updateFailed}, deferred ${summary.deferred}, cancelled ${summary.cancelled ? "yes" : "no"}. Use forced reinstall for repairs.`,
      `スキル更新: 更新 ${summary.updated}、初回同期 ${summary.synchronized}、変更なし ${summary.unchanged}、比較情報なし ${summary.untracked}、要修復 ${summary.repairNeeded}、確認失敗 ${summary.checkFailed}、更新失敗 ${summary.updateFailed}、保留 ${summary.deferred}、中断 ${summary.cancelled ? "あり" : "なし"}。修復には再インストールを使用してください。`,
    );
    if (failures.size || summary.repairNeeded) {
      const report = messages.actionReportBug();
      const diagnostics = `Skill update failures\n${[...failures]
        .map(([kind, count]) => `${kind}=${count}`)
        .join("\n")}`;
      void vscode.window
        .showWarningMessage(message, ...(failures.size ? [report] : []))
        .then(
          (choice) => {
            if (failures.size && choice === report) {
              return vscode.commands.executeCommand(
                "skillNinja.reportBug",
                diagnostics,
              );
            }
          },
          () => undefined,
        )
        .then(undefined, () => undefined);
    } else {
      void vscode.window.showInformationMessage(message);
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
