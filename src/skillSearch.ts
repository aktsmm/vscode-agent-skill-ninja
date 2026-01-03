// スキル検索機能
// キーワードやカテゴリでスキルを検索

import * as vscode from "vscode";
import {
  SkillIndex,
  Skill,
  Source,
  getLocalizedDescription,
} from "./skillIndex";
import { isJapanese } from "./i18n";

// QuickPick用のアイテム型
export interface SkillQuickPickItem extends vscode.QuickPickItem {
  skill: Skill;
}

/**
 * ソースタイプの優先度を取得
 */
function getSourceTypePriority(sourceId: string, sources: Source[]): number {
  const source = sources.find((s) => s.id === sourceId);
  if (!source) return 99;
  const priority: Record<string, number> = {
    official: 0,
    "awesome-list": 1,
    community: 2,
  };
  return priority[source.type] ?? 99;
}

/**
 * スキルの検索スコアを計算
 * 高いスコア = より関連性が高い
 */
function calculateSearchScore(skill: Skill, keywords: string[]): number {
  let score = 0;
  const nameLower = skill.name.toLowerCase();
  const descLower = skill.description.toLowerCase();
  const descJaLower = skill.description_ja?.toLowerCase() || "";
  const categoriesLower = skill.categories.map((c) => c.toLowerCase());
  const sourceLower = skill.source.toLowerCase();

  for (const keyword of keywords) {
    // 名前の完全一致（最高スコア）
    if (nameLower === keyword) {
      score += 100;
    }
    // 名前の先頭一致
    else if (nameLower.startsWith(keyword)) {
      score += 50;
    }
    // 名前の部分一致
    else if (nameLower.includes(keyword)) {
      score += 30;
    }
    // カテゴリの一致
    if (categoriesLower.some((cat) => cat.includes(keyword))) {
      score += 20;
    }
    // 説明文の一致（英語・日本語）
    if (descLower.includes(keyword) || descJaLower.includes(keyword)) {
      score += 10;
    }
    // ソースの一致
    if (sourceLower.includes(keyword)) {
      score += 5;
    }
  }

  return score;
}

/**
 * スキルを検索してQuickPickアイテムに変換
 */
export function searchSkills(
  index: SkillIndex,
  query: string
): SkillQuickPickItem[] {
  const lowerQuery = query.toLowerCase().trim();

  // クエリが空の場合はソースタイプ順でソートして返す
  if (!lowerQuery) {
    const sorted = [...index.skills].sort((a, b) => {
      const priorityA = getSourceTypePriority(a.source, index.sources);
      const priorityB = getSourceTypePriority(b.source, index.sources);
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.name.localeCompare(b.name);
    });
    return sorted.slice(0, 100).map((skill) => skillToQuickPickItem(skill));
  }

  // スペース区切りで複数キーワード対応（AND検索）
  const keywords = lowerQuery.split(/\s+/).filter((k) => k.length > 0);

  // スコア付きでフィルタリング
  const scoredSkills = index.skills
    .map((skill) => ({
      skill,
      score: calculateSearchScore(skill, keywords),
    }))
    .filter(({ score }) => score > 0);

  // ソート: ソースタイプ優先 → スコア順 → 名前順
  scoredSkills.sort((a, b) => {
    // まずソースタイプで比較
    const priorityA = getSourceTypePriority(a.skill.source, index.sources);
    const priorityB = getSourceTypePriority(b.skill.source, index.sources);
    if (priorityA !== priorityB) return priorityA - priorityB;

    // 次にスコアで比較（高い順）
    if (b.score !== a.score) return b.score - a.score;

    // 最後に名前で比較
    return a.skill.name.localeCompare(b.skill.name);
  });

  // 最大100件に制限
  return scoredSkills
    .slice(0, 100)
    .map(({ skill }) => skillToQuickPickItem(skill));
}

/**
 * スキルをQuickPickアイテムに変換
 */
function skillToQuickPickItem(skill: Skill): SkillQuickPickItem {
  const isJa = isJapanese();
  const categoryTags =
    skill.categories.length > 0
      ? skill.categories.map((c) => `#${c}`).join(" ")
      : "";
  const desc = getLocalizedDescription(skill, isJa);

  return {
    label: `$(package) ${skill.name}`,
    description: `$(repo) ${skill.source}`,
    detail: `${desc || (isJa ? "説明なし" : "No description")}${
      categoryTags ? `  ${categoryTags}` : ""
    }`,
    skill: skill,
  };
}

/**
 * カテゴリでスキルをグループ化
 */
export function groupByCategory(index: SkillIndex): Map<string, Skill[]> {
  const groups = new Map<string, Skill[]>();

  for (const skill of index.skills) {
    for (const category of skill.categories) {
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(skill);
    }
  }

  return groups;
}

/**
 * ソースでスキルをグループ化
 */
export function groupBySource(index: SkillIndex): Map<string, Skill[]> {
  const groups = new Map<string, Skill[]>();

  for (const skill of index.skills) {
    if (!groups.has(skill.source)) {
      groups.set(skill.source, []);
    }
    groups.get(skill.source)!.push(skill);
  }

  return groups;
}
