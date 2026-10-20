// 複数スキルの一括インストールで使う、選択・重複・除外の判定。
// vscode に依存しない純粋関数だけを置き、Browse の複数選択 / ピッカー / ソース行の 3 つの入口が同じ規則を使う。

import {
  matchesInvocationFilter,
  sortSkills,
  type SkillViewOptions,
} from "./skillListOptions";

export interface BulkSkillRef {
  name: string;
  source: string;
  stars?: number;
  invocation?: unknown;
}

export interface BulkInstallPlan<T> {
  toInstall: T[];
  /** 既にインストール済みのため除いた件数 */
  alreadyInstalled: number;
  /** 同じソースの同じスキルが重複して渡された件数 */
  duplicates: number;
  /**
   * インストール先のフォルダが、同じ一括内の別のスキルと重なるため除いた件数。
   * フォルダ名は小文字化し空白や記号をハイフンに置換した名前で決まるので、
   * `Code Review` と `code-review` のように名前が違っても同じ場所に入り、上書きし合う。
   */
  nameConflicts: number;
  /**
   * インストール先のフォルダを、別のスキル（別ソースや別名）が既に使っているため除いた件数。
   * 一括実行では上書きの確認を出せず、入れても失敗または上書きになるので、先に除いて理由を示す。
   */
  installedNameConflicts: number;
}

function bulkSkillKey(skill: BulkSkillRef): string {
  return `${skill.source}\u0000${skill.name}`;
}

/**
 * 渡されたスキルから、実際に入れる分を決める。
 * インストール先のフォルダは `folderOf` が返す名前で決まるので、衝突の判定もその名前で行う。
 * `isFolderTaken` はそのフォルダを既に誰かが使っているか（小文字化済みの名前で呼ばれる）。
 */
export function planBulkInstall<T extends BulkSkillRef>(
  skills: readonly T[],
  isInstalled: (skill: T) => boolean,
  isFolderTaken: (folder: string) => boolean = () => false,
  folderOf: (skill: T) => string = (skill) => skill.name,
): BulkInstallPlan<T> {
  const seenKeys = new Set<string>();
  const plannedFolders = new Set<string>();
  const plan: BulkInstallPlan<T> = {
    toInstall: [],
    alreadyInstalled: 0,
    duplicates: 0,
    nameConflicts: 0,
    installedNameConflicts: 0,
  };

  for (const skill of skills) {
    const key = bulkSkillKey(skill);
    if (seenKeys.has(key)) {
      plan.duplicates += 1;
      continue;
    }
    seenKeys.add(key);

    if (isInstalled(skill)) {
      plan.alreadyInstalled += 1;
      continue;
    }

    const folder = folderOf(skill).toLowerCase();
    // 同じスキル自身は上で除いているので、ここで使われているフォルダは別のスキルのもの
    if (isFolderTaken(folder)) {
      plan.installedNameConflicts += 1;
      continue;
    }

    // キーが違うのに同じフォルダになるものは、先に来た方だけを残す
    if (plannedFolders.has(folder)) {
      plan.nameConflicts += 1;
      continue;
    }
    plannedFolders.add(folder);
    plan.toInstall.push(skill);
  }

  return plan;
}

/** 現在の Browse の絞り込み・並べ替えを、一括インストールの候補にも同じように適用する。 */
export function listBulkCandidates<T extends BulkSkillRef>(
  skills: readonly T[],
  options: SkillViewOptions,
): T[] {
  return sortSkills(
    skills.filter((skill) => matchesInvocationFilter(skill, options.filter)),
    options.sort,
  );
}

/** ピッカーで選ばれたもののうち、インストール済みを外す。 */
export function keepSelectable<T>(
  selected: readonly T[],
  isInstalled: (item: T) => boolean,
): T[] {
  return selected.filter((item) => !isInstalled(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * ツリーのコマンドは (クリックした行, 選択中の行[]) で呼ばれる。スキル行だけを取り出す。
 * 選択配列が無い、または空のときはクリックした行だけを対象にする。
 */
export function collectSkillsFromTreeArgs<T extends BulkSkillRef>(
  clicked: unknown,
  selection: unknown,
): T[] {
  const rows: unknown[] =
    Array.isArray(selection) && selection.length > 0
      ? selection
      : clicked !== undefined && clicked !== null
        ? [clicked]
        : [];

  const skills: T[] = [];
  for (const row of rows) {
    if (!isRecord(row) || row.contextValue !== "skill") {
      continue;
    }
    const skill = row.skill;
    if (
      isRecord(skill) &&
      typeof skill.name === "string" &&
      typeof skill.source === "string"
    ) {
      skills.push(skill as unknown as T);
    }
  }
  return skills;
}

/**
 * 複数選択のツリーでは、コマンドの第 2 引数に選択配列が入る。
 * 「インストール先」を第 2 引数に取るコマンドが、配列を誤って先として使わないための判定。
 */
export function isSkillRootLike(value: unknown): boolean {
  return (
    isRecord(value) &&
    !Array.isArray(value) &&
    typeof value.rootPath === "string" &&
    typeof value.scope === "string"
  );
}

/** 件数が多いと時間がかかり、GitHub のレート制限に当たりやすくなるので、確認文に注意を足す目安。 */
export const BULK_INSTALL_LARGE_THRESHOLD = 50;
