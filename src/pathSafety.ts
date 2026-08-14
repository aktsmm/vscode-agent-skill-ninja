// パス封じ込めユーティリティ
// リモート由来のファイル名やメタデータ由来の相対パスが
// スキルルートの外へ書き込み / 削除を行わないようにする
//
// vscode に依存しないので、テストから素の Node で実体を検証できる

import * as fs from "fs";
import * as path from "path";

/**
 * Windows の予約デバイス名（拡張子付きも同じデバイスへ解決される）
 */
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const WINDOWS_INVALID_CHARS = /[<>:"|?*]/;

/**
 * 単一のパスセグメントとして安全かを判定する。
 * ディレクトリ区切り、相対参照、Windows で別名解決される形を拒否する。
 */
export function isSafePathSegment(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0) {
    return false;
  }

  if (name === "." || name === "..") {
    return false;
  }

  if (name.includes("/") || name.includes("\\")) {
    return false;
  }

  if (CONTROL_CHARS.test(name) || WINDOWS_INVALID_CHARS.test(name)) {
    return false;
  }

  // Windows は末尾の空白とドットを黙って落とすため、別セグメントへ化ける
  if (/[ .]$/.test(name)) {
    return false;
  }

  const baseName = name.split(".")[0].toLowerCase();
  if (WINDOWS_RESERVED_NAMES.has(baseName)) {
    return false;
  }

  // Windows は COM¹ / LPT² のような上付き数字もデバイス名へ解決しうる
  if (/^(com|lpt)[\u00b9\u00b2\u00b3]$/i.test(baseName)) {
    return false;
  }

  return true;
}

/**
 * `targetPath` が `rootPath` 配下（または一致）かを判定する。
 */
export function isContainedPath(rootPath: string, targetPath: string): boolean {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedTarget = path.resolve(targetPath);
  const relativePath = path.relative(normalizedRoot, normalizedTarget);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

/**
 * `targetPath` が `rootPath` の**真の**配下（root 自身は除く）かを判定する。
 * ルート自体を削除対象にしないための判定に使う。
 */
export function isStrictlyInsidePath(
  rootPath: string,
  targetPath: string,
): boolean {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedTarget = path.resolve(targetPath);
  const relativePath = path.relative(normalizedRoot, normalizedTarget);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}

/**
 * symlink / junction を解決したうえで、`targetPath` が `rootPath` の真の配下かを判定する。
 *
 * 文字列比較だけでは、ルート配下に作られたリンクがルート外を指していても通ってしまう。
 * 対象がまだ存在しない場合は、実在する最も深い祖先を解決して判定する。
 * リンクが無い環境では文字列判定と同じ結果になる。
 *
 * 検査と書き込みの間にリンクを差し替える競合は、この判定では防げない。
 */
export function isRealPathStrictlyInside(
  rootPath: string,
  targetPath: string,
): boolean {
  if (!isStrictlyInsidePath(rootPath, targetPath)) {
    return false;
  }

  const realRoot = resolveExistingRealPath(rootPath);
  if (!realRoot) {
    // ルートを解決できない環境では、文字列判定より厳しくはしない
    return true;
  }

  const normalizedTarget = path.resolve(targetPath);
  const deepestExisting = resolveDeepestExistingAncestor(normalizedTarget);
  const realTarget = resolveExistingRealPath(deepestExisting);
  if (!realTarget) {
    // 実体はあるのに解決できない場合は、リンク切れの疑いがあるので通さない
    return false;
  }

  // 対象自身が存在しない場合は、実在する祖先までの残りを付け直して判定する
  const unresolvedSuffix = path.relative(deepestExisting, normalizedTarget);
  const candidate = unresolvedSuffix
    ? path.join(realTarget, unresolvedSuffix)
    : realTarget;

  return isStrictlyInsidePath(realRoot, candidate);
}

/**
 * リンク切れも「存在する」と数える。`existsSync` はリンク切れを不在と見なすため、
 * 外部を指すリンク切れが未作成パス扱いで通ってしまう。
 */
function pathEntryExists(targetPath: string): boolean {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveDeepestExistingAncestor(targetPath: string): string {
  let current = path.resolve(targetPath);
  for (;;) {
    if (pathEntryExists(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }
}

function resolveExistingRealPath(targetPath: string): string | undefined {
  const existing = resolveDeepestExistingAncestor(targetPath);
  try {
    return fs.realpathSync.native(existing);
  } catch {
    return undefined;
  }
}

/**
 * 相対パス文字列を安全なセグメント列へ変換する。
 * 1 つでも安全でないセグメントがある、または結果が空なら `undefined` を返す。
 */
export function toSafeRelativeSegments(
  relativePath: unknown,
): string[] | undefined {
  if (typeof relativePath !== "string") {
    return undefined;
  }

  const segments = relativePath.split(/[\\/]/).filter((segment) => segment);
  if (segments.length === 0) {
    return undefined;
  }

  for (const segment of segments) {
    if (!isSafePathSegment(segment)) {
      return undefined;
    }
  }

  return segments;
}

/**
 * 配布元リポジトリ内の相対パスとして安全かを判定する。
 * GitHub API / raw URL のテンプレートへ埋め込む前に使う。
 *
 * `..` はパーセントエンコードしても URL 正規化で親セグメントへ戻り、
 * `raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>` の
 * owner / repo / branch を踏み越えて別リポジトリを取得できてしまう。
 */
export function isSafeRemoteRepoPath(
  remotePath: unknown,
): remotePath is string {
  if (typeof remotePath !== "string" || remotePath.trim().length === 0) {
    return false;
  }

  const trimmed = remotePath.trim();

  if (trimmed.includes("\\") || CONTROL_CHARS.test(trimmed)) {
    return false;
  }

  // scheme + authority, protocol-relative, 絶対パスを拒否する。
  // `notes:2026/SKILL.md` のような colon を含む正当な repo パスは通す
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith("//")) {
    return false;
  }
  if (trimmed.startsWith("/")) {
    return false;
  }

  let decoded = trimmed;
  try {
    // 多重エンコードを想定して繰り返しデコードする
    for (let i = 0; i < 3; i += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    }
  } catch {
    return false;
  }

  if (decoded.includes("\\") || CONTROL_CHARS.test(decoded)) {
    return false;
  }

  for (const segment of decoded.split("/")) {
    if (!segment) {
      continue;
    }
    if (segment === "." || segment === "..") {
      return false;
    }
  }

  return true;
}
