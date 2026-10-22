// スキルルートの識別子・ラベル・読み手を 1 か所に集める。VS Code API に依存しない。
//
// 同名スキルが別ルートにあるとき、ツールの入出力を「名前」ではなく rootId で
// 指せるようにする。Agents Home (~/.agents) と Codex Home (~/.codex) のように
// 取り違えやすい配置は、ラベルに実パスを併記して区別する。

import { createHash } from "crypto";
import * as os from "os";
import * as path from "path";

export type SkillRootKind =
  | "workspace"
  | "home-copilot"
  | "home-claude"
  | "home-agents"
  | "home-codex"
  | "custom";

export interface SkillRootIdentityInput {
  scope: string;
  rootPath: string;
  displayPath: string;
}

export interface SkillRootIdentity {
  /** ツール引数として渡す安定 ID（例: home-codex） */
  id: string;
  kind: SkillRootKind;
  label: { en: string; ja: string };
  /** このルートのスキルを読むエージェント（公式ドキュメント / 実機で確認できたもの） */
  readers: string[];
}

const HOME_ROOTS: ReadonlyArray<{
  kind: Exclude<SkillRootKind, "workspace" | "custom">;
  segments: readonly string[];
  label: { en: string; ja: string };
  readers: string[];
}> = [
  {
    kind: "home-copilot",
    segments: [".copilot", "skills"],
    label: { en: "GitHub Copilot Home", ja: "GitHub Copilot ホーム" },
    readers: ["GitHub Copilot"],
  },
  {
    kind: "home-claude",
    segments: [".claude", "skills"],
    label: { en: "Claude Home", ja: "Claude ホーム" },
    readers: ["Claude Code", "GitHub Copilot"],
  },
  {
    kind: "home-agents",
    segments: [".agents", "skills"],
    label: { en: "Shared Agents Home", ja: "共通 Agents ホーム" },
    readers: ["Codex", "GitHub Copilot"],
  },
  {
    kind: "home-codex",
    segments: [".codex", "skills"],
    label: { en: "Codex Home", ja: "Codex ホーム" },
    readers: ["Codex"],
  },
];

export function normalizeRootPathKey(
  rootPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalized = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function getCodexHomeSkillsPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".codex", "skills");
}

export function resolveSkillRootIdentity(
  root: SkillRootIdentityInput,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
  options: { matchBySuffix?: boolean } = {},
): SkillRootIdentity {
  if (root.scope === "workspace") {
    return {
      id: `workspace:${root.displayPath.replace(/\\/g, "/")}`,
      kind: "workspace",
      label: { en: "Workspace Skills", ja: "ワークスペース スキル" },
      readers: [],
    };
  }

  const key = normalizeRootPathKey(root.rootPath, platform);
  for (const home of HOME_ROOTS) {
    const homeRoot = normalizeRootPathKey(
      path.join(homeDir, ...home.segments),
      platform,
    );
    // 表示用はホームが違っても同じ名前のフォルダを同種として扱う。ID は完全一致のみ。
    const matches =
      key === homeRoot ||
      (options.matchBySuffix === true &&
        key.endsWith(`/${home.segments.join("/")}`));
    if (matches) {
      return {
        id: home.kind,
        kind: home.kind,
        label: home.label,
        readers: [...home.readers],
      };
    }
  }

  // ホーム以外の user root（設定で追加したパスなど）。ID はパスから導く。
  const digest = createHash("sha1").update(key).digest("hex").slice(0, 8);
  return {
    id: `custom:${digest}`,
    kind: "custom",
    label: { en: "Custom Skill Root", ja: "カスタム スキルルート" },
    readers: [],
  };
}

/** ラベルと実パスを併記する。Agents Home と Codex Home の取り違えを防ぐ。 */
export function formatRootWithPath(
  identity: SkillRootIdentity,
  displayPath: string,
  japanese: boolean,
): string {
  return `${japanese ? identity.label.ja : identity.label.en} (${displayPath})`;
}

export function formatRootReaders(
  identity: SkillRootIdentity,
  japanese: boolean,
): string | undefined {
  if (identity.readers.length === 0) {
    return undefined;
  }
  return japanese
    ? `参照: ${identity.readers.join(" / ")}`
    : `Read by: ${identity.readers.join(", ")}`;
}
