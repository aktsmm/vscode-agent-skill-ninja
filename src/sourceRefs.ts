// リモート source の指定に使う純粋ヘルパー。
//
// vscode に依存しないので、実装とテストとスクリプトが同じ 1 本を参照できる。
// 以前は各テストスタブが同じ関数を書き写しており、実装を変えても古いコピーの
// ままテストが通ってしまっていた。

// ソースごとのスキャナ選択。省略時は SKILL.md 走査。
export type SourceScanner =
  | "skill-md"
  | "claude-commands"
  | "top-level-dirs"
  | "registry-json";

const SOURCE_SCANNERS: readonly SourceScanner[] = [
  "skill-md",
  "claude-commands",
  "top-level-dirs",
  "registry-json",
];

/** 共有ストアには別拡張の scanner 値も残るので、走査に使う前に自分が回せる値か確かめる。 */
export function isSourceScanner(value: unknown): value is SourceScanner {
  return (
    typeof value === "string" &&
    (SOURCE_SCANNERS as readonly string[]).includes(value)
  );
}

/**
 * 「未宣言」と「宣言済みだが実装していない」を分ける。
 * 未宣言は repo 名ベースの推定で良いが、別拡張が宣言した scanner を
 * 別の semantics で代替走査すると、違う基準で拾った結果で上書きしてしまう。
 */
export function hasForeignScanner(source: {
  scanner?: string;
}): boolean {
  const declared = source.scanner?.trim();
  return Boolean(declared) && !isSourceScanner(declared);
}

/**
 * ref は URL のパスセグメントとして入るので、"/" は保ったまま
 * セグメント内だけをエスケープする。一括 encodeURIComponent だと "feature/x" が壊れる。
 */
export function encodeGitRef(ref: string): string {
  return ref.split("/").map(encodeURIComponent).join("/");
}
