// スキルインストール機能
// GitHub からスキルをダウンロードしてワークスペースに配置

import * as vscode from "vscode";
import { Skill, loadSkillIndex, Source } from "./skillIndex";
import { isJapanese } from "./i18n";

/**
 * GitHub API でフォルダ内のファイル一覧を取得
 */
async function listGitHubDirectory(
  owner: string,
  repo: string,
  path: string,
  branch: string = "main"
): Promise<{ name: string; type: string; download_url: string | null }[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to list directory: ${response.status}`);
  }
  return (await response.json()) as {
    name: string;
    type: string;
    download_url: string | null;
  }[];
}

/**
 * GitHub API でリポジトリのデフォルトブランチを取得
 */
async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}`;
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (response.ok) {
      const data = (await response.json()) as { default_branch: string };
      return data.default_branch;
    }
  } catch {
    // エラー時はmainにフォールバック
  }
  return "main";
}

/**
 * フォルダを再帰的にダウンロード
 */
async function downloadDirectory(
  owner: string,
  repo: string,
  remotePath: string,
  localPath: vscode.Uri,
  branch: string = "main"
): Promise<void> {
  const entries = await listGitHubDirectory(owner, repo, remotePath, branch);

  for (const entry of entries) {
    const localFilePath = vscode.Uri.joinPath(localPath, entry.name);

    if (entry.type === "file" && entry.download_url) {
      const content = await fetchFileContent(entry.download_url);
      await vscode.workspace.fs.writeFile(
        localFilePath,
        Buffer.from(content, "utf-8")
      );
    } else if (entry.type === "dir") {
      await vscode.workspace.fs.createDirectory(localFilePath);
      await downloadDirectory(
        owner,
        repo,
        `${remotePath}/${entry.name}`,
        localFilePath,
        branch
      );
    }
  }
}

/**
 * スキル名をフォルダ名として安全な形式に変換
 */
function sanitizeSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-") // スペースをハイフンに
    .replace(/[()[\]{}]/g, "") // 括弧を削除
    .replace(/[^a-z0-9\-_]/g, "-") // 英数字とハイフン、アンダースコア以外をハイフンに
    .replace(/-+/g, "-") // 連続ハイフンを1つに
    .replace(/^-|-$/g, ""); // 先頭・末尾のハイフンを削除
}

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

  // スキル名をサニタイズしてフォルダ名として使用
  const safeName = sanitizeSkillName(skill.name);
  const skillPath = vscode.Uri.joinPath(workspaceUri, skillsDir, safeName);
  await vscode.workspace.fs.createDirectory(skillPath);

  // インデックスからソース情報を取得
  const index = await loadSkillIndex(context);
  const source = index.sources.find((s: Source) => s.id === skill.source);

  if (!source) {
    // ソースがない場合はフォールバック
    await createFallbackSkillMd(skillPath, skill);
  } else {
    // GitHub URL からオーナーとリポジトリを取得
    const match = source.url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      await createFallbackSkillMd(skillPath, skill);
    } else {
      const [, owner, repo] = match;
      // ブランチを取得（指定がなければAPIでデフォルトブランチを取得）
      const branch = source.branch || (await getDefaultBranch(owner, repo));
      const remotePath = skill.path;

      console.log(`[Skill Ninja] Installing skill: ${skill.name}`);
      console.log(
        `[Skill Ninja] Owner: ${owner}, Repo: ${repo}, Branch: ${branch}`
      );
      console.log(`[Skill Ninja] Remote path: ${remotePath}`);

      // パスが .md で終わる場合は単独ファイル
      if (remotePath.endsWith(".md")) {
        // 単独ファイルをダウンロード → SKILL.md として保存
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${remotePath}`;
        console.log(`[Skill Ninja] Downloading single file: ${rawUrl}`);
        try {
          const content = await fetchFileContent(rawUrl);
          console.log(`[Skill Ninja] Downloaded ${content.length} bytes`);

          // SKILL.md として保存（メインファイル）
          const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
          await vscode.workspace.fs.writeFile(
            skillMdPath,
            Buffer.from(content, "utf-8")
          );
          console.log(`[Skill Ninja] Saved as SKILL.md`);
        } catch (error) {
          console.error(`[Skill Ninja] Failed to download ${rawUrl}:`, error);
          await createFallbackSkillMd(skillPath, skill);
        }
      } else {
        // フォルダ全体をダウンロード
        try {
          await downloadDirectory(owner, repo, remotePath, skillPath, branch);
          // SKILL.md がなければ作成
          try {
            await vscode.workspace.fs.stat(
              vscode.Uri.joinPath(skillPath, "SKILL.md")
            );
          } catch {
            await createFallbackSkillMd(skillPath, skill);
          }
        } catch {
          await createFallbackSkillMd(skillPath, skill);
        }
      }
    }
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
    description_ja: skill.description_ja,
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

  // まずそのままの名前で試す（既存の互換性）
  let skillPath = vscode.Uri.joinPath(workspaceUri, skillsDir, skillName);

  try {
    await vscode.workspace.fs.stat(skillPath);
  } catch {
    // 存在しない場合はサニタイズした名前で試す
    const safeName = sanitizeSkillName(skillName);
    skillPath = vscode.Uri.joinPath(workspaceUri, skillsDir, safeName);
  }

  try {
    await vscode.workspace.fs.delete(skillPath, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to delete skill directory: ${error}`);
  }
}

/**
 * 相対パスからスキルフォルダを削除
 * SKILL.md の相対パスから親フォルダを特定して削除
 */
export async function uninstallSkillByPath(
  relativePath: string,
  workspaceUri: vscode.Uri
): Promise<void> {
  // relativePath は "folder/SKILL.md" 形式
  // 親フォルダを取得
  const folderPath = relativePath.replace(/\/SKILL\.md$/i, "");
  const skillPath = vscode.Uri.joinPath(workspaceUri, folderPath);

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
  description_ja?: string;
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
    for (const [folderName] of dirs) {
      const metaPath = vscode.Uri.joinPath(
        skillsPath,
        folderName,
        ".skill-meta.json"
      );
      try {
        const content = await vscode.workspace.fs.readFile(metaPath);
        const meta = JSON.parse(Buffer.from(content).toString("utf-8"));
        metas.push(meta);
      } catch {
        // メタデータがない場合は SKILL.md から name と description を読み取る
        const skillMdPath = vscode.Uri.joinPath(
          skillsPath,
          folderName,
          "SKILL.md"
        );
        const { name, description } =
          await extractNameAndDescriptionFromSkillMd(skillMdPath, folderName);
        metas.push({
          name,
          source: "unknown", // メタデータがない古い形式
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
 * SKILL.md ファイルから name と description を抽出する
 * frontmatter の name, description フィールドを読み取る
 */
async function extractNameAndDescriptionFromSkillMd(
  skillMdUri: vscode.Uri,
  fallbackName: string
): Promise<{ name: string; description: string }> {
  try {
    const content = await vscode.workspace.fs.readFile(skillMdUri);
    const text = Buffer.from(content).toString("utf-8");

    // frontmatter を解析
    const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return { name: fallbackName, description: "" };
    }

    const frontmatter = frontmatterMatch[1];

    // name フィールドを抽出
    let name = fallbackName;
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
    }

    // description を抽出
    const description = extractDescriptionFromFrontmatter(frontmatter);

    return { name, description };
  } catch {
    return { name: fallbackName, description: "" };
  }
}

/**
 * frontmatter から description を抽出
 */
function extractDescriptionFromFrontmatter(frontmatter: string): string {
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

    return extractDescriptionFromFrontmatter(frontmatterMatch[1]);
  } catch {
    return "";
  }
}

/**
 * フォールバック SKILL.md を作成
 */
async function createFallbackSkillMd(
  skillPath: vscode.Uri,
  skill: Skill
): Promise<void> {
  const content = `# ${skill.name}

${skill.description}

Source: ${skill.source}
`;
  const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
  await vscode.workspace.fs.writeFile(
    skillMdPath,
    Buffer.from(content, "utf-8")
  );
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
