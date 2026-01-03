// スキルインストール機能
// GitHub からスキルをダウンロードしてワークスペースに配置

import * as vscode from "vscode";
import { Skill, loadSkillIndex, getSkillRawUrl } from "./skillIndex";
import { isJapanese } from "./i18n";

/**
 * スキルをインストールする
 * GitHub からスキルファイルをダウンロードしてワークスペースに配置
 */
export async function installSkill(
  skill: Skill,
  workspaceUri: vscode.Uri,
  context: vscode.ExtensionContext
): Promise<void> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";

  // スキルディレクトリを作成
  const skillPath = vscode.Uri.joinPath(workspaceUri, skillsDir, skill.name);
  await vscode.workspace.fs.createDirectory(skillPath);

  // インデックスからソース情報を取得
  const index = await loadSkillIndex(context);

  // SKILL.md をダウンロード
  const skillMdUrl = getSkillRawUrl(skill, index.sources, "SKILL.md");
  if (skillMdUrl) {
    try {
      const content = await fetchFileContent(skillMdUrl);
      const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
      await vscode.workspace.fs.writeFile(
        skillMdPath,
        Buffer.from(content, "utf-8")
      );
    } catch {
      // SKILL.md がない場合は簡易的なファイルを作成
      const fallbackContent = `# ${skill.name}\n\n${skill.description}\n\nSource: ${skill.source}\n`;
      const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
      await vscode.workspace.fs.writeFile(
        skillMdPath,
        Buffer.from(fallbackContent, "utf-8")
      );
    }
  } else {
    // URL が取得できない場合は簡易的なファイルを作成
    const fallbackContent = `# ${skill.name}\n\n${skill.description}\n\nSource: ${skill.source}\n`;
    const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
    await vscode.workspace.fs.writeFile(
      skillMdPath,
      Buffer.from(fallbackContent, "utf-8")
    );
  }

  // メタデータを保存（description などを後で取得できるように）
  // 英語環境の場合はSKILL.mdからdescriptionを抽出（インデックスは日本語のため）
  let description = skill.description;
  if (!isJapanese()) {
    const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
    const extractedDesc = await extractDescriptionFromSkillMd(skillMdPath);
    if (extractedDesc) {
      description = extractedDesc;
    }
  }

  const metaPath = vscode.Uri.joinPath(skillPath, ".skill-meta.json");
  const meta = {
    name: skill.name,
    source: skill.source,
    description: description,
    categories: skill.categories,
    installedAt: new Date().toISOString(),
  };
  await vscode.workspace.fs.writeFile(
    metaPath,
    Buffer.from(JSON.stringify(meta, null, 2), "utf-8")
  );
}

/**
 * スキルをアンインストールする
 */
export async function uninstallSkill(
  skillName: string,
  workspaceUri: vscode.Uri
): Promise<void> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";

  const skillPath = vscode.Uri.joinPath(workspaceUri, skillsDir, skillName);

  try {
    await vscode.workspace.fs.delete(skillPath, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to delete skill directory: ${error}`);
  }
}

/**
 * インストール済みスキルの一覧を取得
 */
export async function getInstalledSkills(
  workspaceUri: vscode.Uri
): Promise<string[]> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";

  const skillsPath = vscode.Uri.joinPath(workspaceUri, skillsDir);

  try {
    const entries = await vscode.workspace.fs.readDirectory(skillsPath);
    // ディレクトリのみを返す
    return entries
      .filter(([, type]) => type === vscode.FileType.Directory)
      .map(([name]) => name);
  } catch {
    // ディレクトリが存在しない場合は空配列
    return [];
  }
}

/**
 * スキルのメタデータ
 */
export interface SkillMeta {
  name: string;
  source: string;
  description: string;
  categories: string[];
  installedAt: string;
}

/**
 * インストール済みスキルのメタデータを取得
 */
export async function getInstalledSkillsWithMeta(
  workspaceUri: vscode.Uri
): Promise<SkillMeta[]> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";
  const skillsPath = vscode.Uri.joinPath(workspaceUri, skillsDir);

  try {
    const entries = await vscode.workspace.fs.readDirectory(skillsPath);
    const dirs = entries.filter(
      ([, type]) => type === vscode.FileType.Directory
    );

    const metas: SkillMeta[] = [];
    for (const [name] of dirs) {
      const metaPath = vscode.Uri.joinPath(
        skillsPath,
        name,
        ".skill-meta.json"
      );
      try {
        const content = await vscode.workspace.fs.readFile(metaPath);
        const meta = JSON.parse(Buffer.from(content).toString("utf-8"));
        metas.push(meta);
      } catch {
        // メタデータがない場合は SKILL.md から description を読み取る
        const description = await extractDescriptionFromSkillMd(
          vscode.Uri.joinPath(skillsPath, name, "SKILL.md")
        );
        metas.push({
          name,
          source: "local",
          description,
          categories: [],
          installedAt: "",
        });
      }
    }
    return metas;
  } catch {
    return [];
  }
}

/**
 * SKILL.md ファイルから description を抽出する
 * frontmatter の description フィールドを読み取り、長い場合は切り詰める
 */
async function extractDescriptionFromSkillMd(
  skillMdUri: vscode.Uri
): Promise<string> {
  try {
    const content = await vscode.workspace.fs.readFile(skillMdUri);
    const text = Buffer.from(content).toString("utf-8");

    // frontmatter を解析
    const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return "";
    }

    const frontmatter = frontmatterMatch[1];

    // description フィールドを抽出（複数行対応）
    // パターン1: description: "..."（ダブルクォート）
    // パターン2: description: '...'（シングルクォート）
    // パターン3: description: ...（クォートなし、1行）
    let description = "";

    // ダブルクォート対応
    const doubleQuoteMatch = frontmatter.match(
      /^description:\s*"([^"]*(?:""[^"]*)*)"/m
    );
    if (doubleQuoteMatch) {
      description = doubleQuoteMatch[1].replace(/""/g, '"');
    }

    // シングルクォート対応
    if (!description) {
      const singleQuoteMatch = frontmatter.match(
        /^description:\s*'([^']*(?:''[^']*)*)'/m
      );
      if (singleQuoteMatch) {
        description = singleQuoteMatch[1].replace(/''/g, "'");
      }
    }

    // クォートなし（1行）
    if (!description) {
      const plainMatch = frontmatter.match(/^description:\s*(.+)$/m);
      if (plainMatch) {
        description = plainMatch[1].trim();
      }
    }

    // 長い説明は切り詰める（AGENTS.md 用に短くする）
    const maxLength = 80;
    if (description.length > maxLength) {
      // 日本語の文末（。）か英語の文末（.）で切る
      const periodIndex = description.indexOf("。");
      const dotIndex = description.indexOf(". ");
      const cutIndex =
        periodIndex !== -1 && periodIndex < maxLength
          ? periodIndex + 1
          : dotIndex !== -1 && dotIndex < maxLength
          ? dotIndex + 1
          : maxLength;

      description = description.substring(0, cutIndex).trim();
      if (description.length === maxLength) {
        description += "...";
      }
    }

    return description;
  } catch {
    return "";
  }
}

/**
 * URL からファイル内容を取得
 */
async function fetchFileContent(url: string): Promise<string> {
  // VS Code の fetch API を使用（Node.js 18+ の fetch）
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return await response.text();
}
