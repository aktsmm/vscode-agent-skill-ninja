// SKILL.md を持つフォルダの配下に、さらに SKILL.md を持つフォルダがあるときの親子判定。
// vscode に依存しない純粋関数だけを置く。ツリー表示と instruction 生成が同じ規則を使う。

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/**
 * relativePath の最も近い祖先のうち、allPaths に含まれるものを返す。
 * スキルルート自体（空パス）は祖先として扱わない。
 */
export function findEmbeddedParentPath(
  relativePath: string,
  allPaths: ReadonlySet<string>,
): string | undefined {
  const segments = normalizeRelativePath(relativePath).split("/");
  for (let length = segments.length - 1; length >= 1; length -= 1) {
    const candidate = segments.slice(0, length).join("/");
    if (allPaths.has(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** 別のスキルフォルダの内側にあるスキルか。 */
export function isEmbeddedSkillPath(
  relativePath: string,
  allPaths: ReadonlySet<string>,
): boolean {
  return findEmbeddedParentPath(relativePath, allPaths) !== undefined;
}

export interface EmbeddedSkillHierarchy<T> {
  topLevel: T[];
  childrenOf(parentRelativePath: string): T[];
  parentOf(relativePath: string): string | undefined;
}

/**
 * 同じスキルルートのスキル一覧を、親子の階層にする。入力の並び順は保つ。
 * 絞り込みで親が一覧から外れた子は、残っている最も近い祖先の子になり、祖先がなければ最上位に出す。
 */
export function buildEmbeddedHierarchy<T extends { relativePath: string }>(
  skills: readonly T[],
): EmbeddedSkillHierarchy<T> {
  const paths = new Set(
    skills.map((skill) => normalizeRelativePath(skill.relativePath)),
  );
  const childrenByParent = new Map<string, T[]>();
  const parentByPath = new Map<string, string>();
  const topLevel: T[] = [];

  for (const skill of skills) {
    const key = normalizeRelativePath(skill.relativePath);
    const parent = findEmbeddedParentPath(key, paths);
    if (!parent) {
      topLevel.push(skill);
      continue;
    }
    parentByPath.set(key, parent);
    const siblings = childrenByParent.get(parent);
    if (siblings) {
      siblings.push(skill);
    } else {
      childrenByParent.set(parent, [skill]);
    }
  }

  return {
    topLevel,
    childrenOf: (parentRelativePath) =>
      childrenByParent.get(normalizeRelativePath(parentRelativePath)) ?? [],
    parentOf: (relativePath) =>
      parentByPath.get(normalizeRelativePath(relativePath)),
  };
}

/** 親フォルダからの相対パス。親が合わない場合は元のパスを返す。 */
export function getPathRelativeToParent(
  relativePath: string,
  parentRelativePath: string | undefined,
): string {
  const normalized = normalizeRelativePath(relativePath);
  if (!parentRelativePath) {
    return normalized;
  }
  const prefix = `${normalizeRelativePath(parentRelativePath)}/`;
  return normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : normalized;
}
