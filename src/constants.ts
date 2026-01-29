/**
 * 共通定数定義
 */

/** スキル説明の長さ制限 */
export const SKILL_DESCRIPTION_LIMITS = {
  /** 合計最大文字数 */
  MAX_TOTAL: 200,
  /** 各項目の最大文字数 */
  MAX_EACH: 100,
  /** 省略記号の長さ */
  ELLIPSIS_LENGTH: 3,
} as const;

/** ライセンス抽出の設定 */
export const LICENSE_EXTRACTION = {
  /** ライセンスファイル候補 */
  FILE_NAMES: ["LICENSE.txt", "LICENSE", "LICENSE.md"] as const,
  /** スキャンする最大文字数 */
  SCAN_LENGTH: 2000,
} as const;

/** 検索・インデックス関連 */
export const INDEX_LIMITS = {
  /** 短い説明の最大文字数 */
  SHORT_DESCRIPTION: 80,
  /** プレビュー表示の最大文字数 */
  PREVIEW_LENGTH: 100,
} as const;
