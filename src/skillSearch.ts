// スキル検索機能
// キーワードやカテゴリでスキルを検索

import * as vscode from "vscode";
import { SkillIndex, Skill } from "./skillIndex";

// QuickPick用のアイテム型
export interface SkillQuickPickItem extends vscode.QuickPickItem {
  skill: Skill;
}

/**
 * スキルを検索してQuickPickアイテムに変換
 */
export function searchSkills(
  index: SkillIndex,
  query: string
): SkillQuickPickItem[] {
  const lowerQuery = query.toLowerCase().trim();

  // クエリが空の場合は全件返す（最大100件）
  let filtered = index.skills;

  if (lowerQuery) {
    filtered = index.skills.filter((skill) => {
      // 名前で検索
      if (skill.name.toLowerCase().includes(lowerQuery)) {
        return true;
      }
      // 説明で検索
      if (skill.description.toLowerCase().includes(lowerQuery)) {
        return true;
      }
      // カテゴリで検索
      if (
        skill.categories.some((cat) => cat.toLowerCase().includes(lowerQuery))
      ) {
        return true;
      }
      // ソースで検索
      if (skill.source.toLowerCase().includes(lowerQuery)) {
        return true;
      }
      return false;
    });
  }

  // 最大100件に制限
  const limited = filtered.slice(0, 100);

  // QuickPickアイテムに変換（説明文をわかりやすく）
  return limited.map((skill) => {
    // カテゴリをタグ形式で表示
    const categoryTags =
      skill.categories.length > 0
        ? skill.categories.map((c) => `#${c}`).join(" ")
        : "";

    return {
      label: `$(package) ${skill.name}`,
      description: `$(repo) ${skill.source}`,
      detail: `${skill.description || "No description"}${
        categoryTags ? `  ${categoryTags}` : ""
      }`,
      skill: skill,
    };
  });
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
