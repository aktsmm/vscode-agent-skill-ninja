// スキルインストール機能
// GitHub からスキルをダウンロードしてワークスペースに配置

import * as vscode from "vscode";
import { Skill, loadSkillIndex, Source, getSourceBranch } from "./skillIndex";
import { isJapanese } from "./i18n";

/**
 * GitHub API でフォルダ内のファイル一覧を取得
 */
async function listGitHubDirectory(
  owner: string,
  repo: string,
  path: string,
  branch: string = "main",
  token?: string,
): Promise<{ name: string; type: string; download_url: string | null }[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };
  if (token) {
    headers["Authorization"] = `token ${token}`;
  }
  const response = await fetch(url, { headers });
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
 * フォルダを再帰的にダウンロード
 */
async function downloadDirectory(
  owner: string,
  repo: string,
  remotePath: string,
  localPath: vscode.Uri,
  branch: string = "main",
  token?: string,
): Promise<void> {
  console.log(
    `[Skill Ninja] Downloading directory: ${owner}/${repo}/${remotePath} (branch: ${branch})`,
  );

  const entries = await listGitHubDirectory(
    owner,
    repo,
    remotePath,
    branch,
    token,
  );
  console.log(`[Skill Ninja] Found ${entries.length} entries`);

  for (const entry of entries) {
    const localFilePath = vscode.Uri.joinPath(localPath, entry.name);

    if (entry.type === "file" && entry.download_url) {
      console.log(`[Skill Ninja] Downloading file: ${entry.name}`);
      const content = await fetchFileContent(entry.download_url, token);
      await vscode.workspace.fs.writeFile(
        localFilePath,
        Buffer.from(content, "utf-8"),
      );
    } else if (entry.type === "dir") {
      await vscode.workspace.fs.createDirectory(localFilePath);
      await downloadDirectory(
        owner,
        repo,
        `${remotePath}/${entry.name}`,
        localFilePath,
        branch,
        token,
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
  context: vscode.ExtensionContext,
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

  // GitHub Token を取得
  const token = config.get<string>("githubToken");

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
      // ブランチを取得（HEAD確認 or API でデフォルトブランチを取得）
      const branch = await getSourceBranch(source, token, skill.path);
      const remotePath = skill.path;

      console.log(`[Skill Ninja] Installing skill: ${skill.name}`);
      console.log(
        `[Skill Ninja] Owner: ${owner}, Repo: ${repo}, Branch: ${branch}`,
      );
      console.log(`[Skill Ninja] Remote path: ${remotePath}`);

      // パスが .md で終わる場合は単独ファイル
      if (remotePath.endsWith(".md")) {
        // 単独ファイルをダウンロード → SKILL.md として保存
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${remotePath}`;
        console.log(`[Skill Ninja] Downloading single file: ${rawUrl}`);
        try {
          const content = await fetchFileContent(rawUrl, token);
          console.log(`[Skill Ninja] Downloaded ${content.length} bytes`);

          // SKILL.md として保存（メインファイル）
          const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
          await vscode.workspace.fs.writeFile(
            skillMdPath,
            Buffer.from(content, "utf-8"),
          );
          console.log(`[Skill Ninja] Saved as SKILL.md`);
        } catch (error) {
          console.error(`[Skill Ninja] Failed to download ${rawUrl}:`, error);
          const errorMsg =
            error instanceof Error ? error.message : String(error);

          // 404エラーの場合はインストールをキャンセル（フォールバック作らない）
          if (errorMsg.includes("404")) {
            // 作成したフォルダを削除
            try {
              await vscode.workspace.fs.delete(skillPath, { recursive: true });
            } catch {
              // 削除失敗は無視
            }

            // バグレポートオプションを提供
            const updateIndex = isJapanese()
              ? "インデックス更新"
              : "Update Index";
            const reportBug = isJapanese() ? "バグ報告" : "Report Bug";

            const choice = await vscode.window.showErrorMessage(
              isJapanese()
                ? `スキル "${skill.name}" が見つかりません。\nスキルインデックスの情報が古い可能性があります。`
                : `Skill "${skill.name}" not found.\nThe skill index may be outdated.`,
              updateIndex,
              reportBug,
            );

            if (choice === updateIndex) {
              // Update Index from Sources コマンドを実行
              await vscode.commands.executeCommand(
                "skillNinja.updateIndexFromSources",
              );
            } else if (choice === reportBug) {
              // バグレポートを作成
              await openBugReport(skill, source, rawUrl, "404 Not Found");
            }

            throw new Error(`Skill not found: ${skill.name}`);
          }

          // その他のエラーはフォールバック版を作成
          vscode.window.showWarningMessage(
            isJapanese()
              ? `スキル "${skill.name}" のダウンロードに失敗しました。フォールバック版を作成します。\nエラー: ${errorMsg}`
              : `Failed to download skill "${skill.name}". Creating fallback version.\nError: ${errorMsg}`,
          );
          await createFallbackSkillMd(skillPath, skill);
        }
      } else {
        // フォルダ全体をダウンロード
        try {
          await downloadDirectory(
            owner,
            repo,
            remotePath,
            skillPath,
            branch,
            token,
          );
          // SKILL.md がなければ作成
          try {
            await vscode.workspace.fs.stat(
              vscode.Uri.joinPath(skillPath, "SKILL.md"),
            );
          } catch {
            await createFallbackSkillMd(skillPath, skill);
          }
        } catch (error) {
          console.error(`[Skill Ninja] Failed to download directory:`, error);
          // Don't overwrite SKILL.md with fallback if it was already downloaded
          const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
          let skillMdExists = false;
          try {
            const stat = await vscode.workspace.fs.stat(skillMdPath);
            // Consider valid if > 100 bytes
            skillMdExists = stat.size > 100;
          } catch {
            // File does not exist
          }
          if (!skillMdExists) {
            await createFallbackSkillMd(skillPath, skill);
          } else {
            console.log(
              `[Skill Ninja] SKILL.md already exists, skipping fallback creation`,
            );
            // Notify user that some subdirectory files may be missing
            vscode.window.showWarningMessage(
              isJapanese()
                ? `スキル "${skill.name}" の一部のファイルがダウンロードできませんでした。SKILL.md は正常にインストールされています。`
                : `Some files for skill "${skill.name}" could not be downloaded. SKILL.md was installed successfully.`,
            );
          }
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

  // "When to Use" セクションを抽出
  const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
  const whenToUse = await extractWhenToUseFromSkillMd(skillMdPath);

  // 既存のメタデータからカスタム値を保持
  const metaPath = vscode.Uri.joinPath(skillPath, ".skill-meta.json");
  let existingCustomWhenToUse: string | undefined;
  try {
    const existingContent = await vscode.workspace.fs.readFile(metaPath);
    const existingMeta = JSON.parse(
      Buffer.from(existingContent).toString("utf-8"),
    );
    existingCustomWhenToUse = existingMeta.customWhenToUse;
  } catch {
    // 既存のメタデータがない場合は無視
  }

  const meta: SkillMeta = {
    name: skill.name,
    source: skill.source,
    description: description,
    description_ja: skill.description_ja,
    whenToUse: whenToUse || undefined,
    customWhenToUse: existingCustomWhenToUse, // ユーザーのカスタム値を保持
    categories: skill.categories,
    installedAt: new Date().toISOString(),
  };
  await vscode.workspace.fs.writeFile(
    metaPath,
    Buffer.from(JSON.stringify(meta, null, 2), "utf-8"),
  );

  // インストール後の検証: SKILL.md が空またはフォールバック版かチェック
  await validateInstalledSkill(skillPath, skill, source);
}

/**
 * インストールされたスキルを検証し、問題があればバグレポートを提案
 */
async function validateInstalledSkill(
  skillPath: vscode.Uri,
  skill: Skill,
  source?: Source,
): Promise<void> {
  const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");

  try {
    const content = await vscode.workspace.fs.readFile(skillMdPath);
    const text = Buffer.from(content).toString("utf-8");

    // フォールバック版の検出（テンプレート形式）
    const isFallback =
      text.includes(`Source: ${skill.source}`) &&
      !text.includes("---") && // frontmatter がない
      text.split("\n").filter((l) => l.trim()).length <= 5; // 5行以下

    // 空または非常に短いコンテンツ
    const isEmpty = text.trim().length < 50;

    if (isFallback || isEmpty) {
      console.warn(
        `[Skill Ninja] Skill "${skill.name}" appears to be a fallback or empty`,
      );

      const reportBug = isJapanese() ? "バグ報告" : "Report Bug";
      const ignore = isJapanese() ? "無視" : "Ignore";

      const choice = await vscode.window.showWarningMessage(
        isJapanese()
          ? `スキル "${skill.name}" のインストールに問題がある可能性があります。\nSKILL.md の内容が不完全です。`
          : `Skill "${skill.name}" may not have installed correctly.\nSKILL.md content appears incomplete.`,
        reportBug,
        ignore,
      );

      if (choice === reportBug) {
        // GitHub Issue 作成リンクを開く
        const extensionVersion =
          vscode.extensions.getExtension("yamapan.agent-skill-ninja")
            ?.packageJSON?.version || "unknown";

        // ソース情報を取得
        const repoUrl = source?.url || "unknown";
        const branch = source?.branch || "default";

        const issueTitle = `[Bug] Skill install incomplete: ${skill.name}`;
        const issueBody =
          `**Issue**\n` +
          `Skill "${skill.name}" from source "${skill.source}" was not installed correctly.\n\n` +
          `**Expected**\n` +
          `SKILL.md should contain the full skill content.\n\n` +
          `**Actual**\n` +
          `SKILL.md contains only fallback/template content (${text.length} bytes).\n\n` +
          `**Skill Details**\n` +
          `- Name: ${skill.name}\n` +
          `- Source ID: ${skill.source}\n` +
          `- Path: ${skill.path || "unknown"}\n` +
          `- Repository: ${repoUrl}\n` +
          `- Branch: ${branch}\n\n` +
          `**Environment**\n` +
          `- Extension Version: ${extensionVersion}\n` +
          `- VS Code: ${vscode.version}\n` +
          `- OS: ${process.platform}\n\n` +
          `**SKILL.md Content (first 200 chars)**\n` +
          `\`\`\`\n${text.substring(0, 200)}\n\`\`\``;

        // URLパラメータをエンコード
        const params = new URLSearchParams({
          title: issueTitle,
          body: issueBody,
        });
        const issueUrl = `https://github.com/aktsmm/vscode-agent-skill-ninja/issues/new?${params.toString()}`;
        await vscode.env.openExternal(vscode.Uri.parse(issueUrl));
      }
    }
  } catch (error) {
    console.error(
      `[Skill Ninja] Failed to validate skill "${skill.name}":`,
      error,
    );
  }
}

/**
 * スキルをアンインストールする
 */
export async function uninstallSkill(
  skillName: string,
  workspaceUri: vscode.Uri,
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
  workspaceUri: vscode.Uri,
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
  workspaceUri: vscode.Uri,
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
  whenToUse?: string; // SKILL.md の "When to Use" セクションから抽出
  customWhenToUse?: string; // ユーザーがカスタマイズした説明（最優先）
  categories: string[];
  installedAt: string;
}

/**
 * インストール済みスキルのメタデータを取得
 */
export async function getInstalledSkillsWithMeta(
  workspaceUri: vscode.Uri,
): Promise<SkillMeta[]> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";
  const skillsPath = vscode.Uri.joinPath(workspaceUri, skillsDir);

  try {
    const entries = await vscode.workspace.fs.readDirectory(skillsPath);
    const dirs = entries.filter(
      ([, type]) => type === vscode.FileType.Directory,
    );

    const metas: SkillMeta[] = [];
    for (const [folderName] of dirs) {
      const metaPath = vscode.Uri.joinPath(
        skillsPath,
        folderName,
        ".skill-meta.json",
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
          "SKILL.md",
        );
        const { name, description } =
          await extractNameAndDescriptionFromSkillMd(skillMdPath, folderName);
        // When to Use セクションも抽出
        const whenToUse = await extractWhenToUseFromSkillMd(skillMdPath);
        metas.push({
          name,
          source: "unknown", // メタデータがない古い形式
          description,
          whenToUse: whenToUse || undefined,
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
 * frontmatter がない場合は # ヘッダーから name を抽出
 */
async function extractNameAndDescriptionFromSkillMd(
  skillMdUri: vscode.Uri,
  fallbackName: string,
): Promise<{ name: string; description: string }> {
  try {
    const content = await vscode.workspace.fs.readFile(skillMdUri);
    const text = Buffer.from(content).toString("utf-8");

    // frontmatter を解析
    const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
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
    }

    // frontmatter がない場合は # ヘッダーから name を抽出
    const headerMatch = text.match(/^#\s+(.+)$/m);
    if (headerMatch) {
      const name = headerMatch[1].trim();
      // 2行目以降で説明文を探す（空行を除く）
      const lines = text.split("\n").slice(1);
      let description = "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          trimmed &&
          !trimmed.startsWith("#") &&
          !trimmed.startsWith("Source:")
        ) {
          description = trimmed;
          break;
        }
      }
      return { name, description };
    }

    return { name: fallbackName, description: "" };
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
    /^description:\s*"([^"]*(?:""[^"]*)*)"/m,
  );
  if (doubleQuoteMatch) {
    description = doubleQuoteMatch[1].replace(/""/g, '"');
  }

  // シングルクォート対応
  if (!description) {
    const singleQuoteMatch = frontmatter.match(
      /^description:\s*'([^']*(?:''[^']*)*)'/m,
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
  const maxLength = 200;
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
  skillMdUri: vscode.Uri,
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
 * SKILL.md ファイルから "When to Use" セクションを抽出する
 * ## When to Use または ## いつ使うか などのセクションを検出し、内容を返す
 * セクションがない場合は、# タイトルの次の段落を使用
 */
async function extractWhenToUseFromSkillMd(
  skillMdUri: vscode.Uri,
): Promise<string> {
  try {
    const content = await vscode.workspace.fs.readFile(skillMdUri);
    const text = Buffer.from(content).toString("utf-8");

    // "When to Use" セクションを検出（英語・日本語対応）
    const sectionMatch = text.match(
      /^##\s*(When to Use|When To Use|いつ使うか|使用タイミング|Usage|使い方)\s*\n([\s\S]*?)(?=\n##\s|\n---|\n\*\*|$)/im,
    );

    let sectionContent = "";

    if (sectionMatch) {
      sectionContent = sectionMatch[2].trim();
    } else {
      // フォールバック: # タイトルの次の段落を抽出
      // frontmatter をスキップ
      let bodyText = text;
      const frontmatterMatch = text.match(/^---\n[\s\S]*?\n---\n*/);
      if (frontmatterMatch) {
        bodyText = text.substring(frontmatterMatch[0].length);
      }

      // # タイトル行を見つけて、その後の最初の段落を取得
      const lines = bodyText.split("\n");
      let foundTitle = false;
      const paragraphLines: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();

        if (!foundTitle) {
          // # で始まるタイトル行を探す
          if (/^#\s+/.test(trimmed)) {
            foundTitle = true;
          }
          continue;
        }

        // タイトル後の空行をスキップ
        if (!trimmed) {
          if (paragraphLines.length > 0) {
            // 段落が終わった
            break;
          }
          continue;
        }

        // 次のセクション（## など）に到達したら終了
        if (/^#/.test(trimmed)) {
          break;
        }

        // コードブロック、リスト等はスキップ
        if (/^```/.test(trimmed) || /^[-*]\s+\*\*/.test(trimmed)) {
          break;
        }

        paragraphLines.push(trimmed);

        // 最大2行まで
        if (paragraphLines.length >= 2) {
          break;
        }
      }

      sectionContent = paragraphLines.join(" ");
    }

    if (!sectionContent) {
      return "";
    }

    // リスト形式の場合、最初の数項目を抽出
    const lines = sectionContent.split("\n");
    const bulletPoints: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // リスト項目を検出（- や * や 数字. で始まる行）
      if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        // マーカーを除去して内容のみ取得
        const itemContent = trimmed
          .replace(/^[-*•]\s+/, "")
          .replace(/^\d+\.\s+/, "");
        bulletPoints.push(itemContent);
      } else if (
        trimmed &&
        !trimmed.startsWith("#") &&
        bulletPoints.length === 0
      ) {
        // 段落テキストの場合（リストがまだない場合）
        bulletPoints.push(trimmed);
      }

      // 最大3項目まで
      if (bulletPoints.length >= 3) {
        break;
      }
    }

    if (bulletPoints.length === 0) {
      return "";
    }

    // 短い形式で結合
    let result = bulletPoints.join("; ");

    // 長すぎる場合は切り詰め
    const maxLength = 200;
    if (result.length > maxLength) {
      result = result.substring(0, maxLength - 3) + "...";
    }

    return result;
  } catch {
    return "";
  }
}

/**
 * フォールバック SKILL.md を作成
 */
async function createFallbackSkillMd(
  skillPath: vscode.Uri,
  skill: Skill,
): Promise<void> {
  const content = `# ${skill.name}

${skill.description}

Source: ${skill.source}
`;
  const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
  await vscode.workspace.fs.writeFile(
    skillMdPath,
    Buffer.from(content, "utf-8"),
  );
}

/**
 * バグレポートを GitHub Issue として開く
 */
async function openBugReport(
  skill: Skill,
  source: Source | undefined,
  url: string,
  errorType: string,
): Promise<void> {
  const extensionVersion =
    vscode.extensions.getExtension("yamapan.agent-skill-ninja")?.packageJSON
      ?.version || "unknown";

  const repoUrl = source?.url || "unknown";
  const branch = source?.branch || "default";

  const issueTitle = `[Bug] Skill not found: ${skill.name}`;
  const issueBody =
    `**Issue**\n` +
    `Skill "${skill.name}" from source "${skill.source}" could not be downloaded.\n\n` +
    `**Error**\n` +
    `${errorType}\n\n` +
    `**Skill Details**\n` +
    `- Name: ${skill.name}\n` +
    `- Source ID: ${skill.source}\n` +
    `- Path: ${skill.path || "unknown"}\n` +
    `- Repository: ${repoUrl}\n` +
    `- Branch: ${branch}\n` +
    `- Failed URL: ${url}\n\n` +
    `**Environment**\n` +
    `- Extension Version: ${extensionVersion}\n` +
    `- VS Code: ${vscode.version}\n` +
    `- OS: ${process.platform}\n\n` +
    `**Possible Cause**\n` +
    `The skill index may contain outdated paths that no longer exist in the repository.`;

  const params = new URLSearchParams({
    title: issueTitle,
    body: issueBody,
  });
  const issueUrl = `https://github.com/aktsmm/vscode-agent-skill-ninja/issues/new?${params.toString()}`;
  await vscode.env.openExternal(vscode.Uri.parse(issueUrl));
}

/**
 * URL からファイル内容を取得
 */
async function fetchFileContent(url: string, token?: string): Promise<string> {
  // VS Code の fetch API を使用（Node.js 18+ の fetch）
  const headers: Record<string, string> = {};
  // raw.githubusercontent.com は Token 不要（公開リポジトリ）
  // Token を付けると逆にエラーになることがある
  if (token && !url.includes("raw.githubusercontent.com")) {
    headers["Authorization"] = `token ${token}`;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${response.statusText} (URL: ${url})`,
    );
  }
  const text = await response.text();
  if (!text || text.trim().length === 0) {
    throw new Error(`Empty response from ${url}`);
  }
  return text;
}
