// スキルインストール機能
// GitHub からスキルをダウンロードしてワークスペースに配置

import * as vscode from "vscode";
import { Skill, loadSkillIndex, Source, getSourceBranch } from "./skillIndex";
import { isJapanese } from "./i18n";
import { getGitHubToken } from "./githubAuth";

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
    if (response.status === 403) {
      throw new Error(
        `GitHub API rate limit exceeded (403). Please authenticate with a GitHub token.`,
      );
    }
    throw new Error(`Failed to list directory: ${response.status}`);
  }
  return (await response.json()) as {
    name: string;
    type: string;
    download_url: string | null;
  }[];
}

/**
 * サブディレクトリの最大ダウンロード数
 * 巨大なリポジトリ（例: Fabric の Patterns 240+ディレクトリ）で
 * GitHub API レート制限に当たるのを防止
 * 認証済み(5000回/時)なら余裕、未認証(60回/時)だと厳しいが
 * 未認証の場合はそもそも他の処理でも制限に当たるので300で許容
 */
const MAX_SUBDIRECTORY_DOWNLOADS = 300;

/**
 * フォルダを再帰的にダウンロード
 * ファイルをディレクトリより先にダウンロードし、
 * サブディレクトリのエラーは個別にキャッチして全体のクラッシュを防止
 */
async function downloadDirectory(
  owner: string,
  repo: string,
  remotePath: string,
  localPath: vscode.Uri,
  branch: string = "main",
  token?: string,
  depth: number = 0,
): Promise<{ errors: string[] }> {
  const errors: string[] = [];

  console.log(
    `[Skill Ninja] Downloading directory: ${owner}/${repo}/${remotePath} (branch: ${branch}, depth: ${depth})`,
  );

  const entries = await listGitHubDirectory(
    owner,
    repo,
    remotePath,
    branch,
    token,
  );
  console.log(`[Skill Ninja] Found ${entries.length} entries`);

  // ファイルとディレクトリを分離し、ファイルを先にダウンロード
  // （SKILL.md などの重要ファイルを確実に取得するため）
  const files = entries.filter((e) => e.type === "file" && e.download_url);
  const dirs = entries.filter((e) => e.type === "dir");

  // 1. ファイルを先にダウンロード
  for (const entry of files) {
    const localFilePath = vscode.Uri.joinPath(localPath, entry.name);
    try {
      console.log(`[Skill Ninja] Downloading file: ${entry.name}`);
      const content = await fetchFileContent(entry.download_url!, token);
      await vscode.workspace.fs.writeFile(
        localFilePath,
        Buffer.from(content, "utf-8"),
      );
    } catch (error) {
      const msg = `Failed to download file ${entry.name}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[Skill Ninja] ${msg}`);
      errors.push(msg);
    }
  }

  // 2. サブディレクトリを再帰的にダウンロード（数の制限あり）
  if (dirs.length > MAX_SUBDIRECTORY_DOWNLOADS) {
    console.warn(
      `[Skill Ninja] Too many subdirectories (${dirs.length}), limiting to ${MAX_SUBDIRECTORY_DOWNLOADS}`,
    );
    errors.push(
      `Skipped ${dirs.length - MAX_SUBDIRECTORY_DOWNLOADS} of ${dirs.length} subdirectories (limit: ${MAX_SUBDIRECTORY_DOWNLOADS})`,
    );
  }

  const dirsToDownload = dirs.slice(0, MAX_SUBDIRECTORY_DOWNLOADS);

  for (const entry of dirsToDownload) {
    const localFilePath = vscode.Uri.joinPath(localPath, entry.name);
    try {
      await vscode.workspace.fs.createDirectory(localFilePath);
      const subResult = await downloadDirectory(
        owner,
        repo,
        `${remotePath}/${entry.name}`,
        localFilePath,
        branch,
        token,
        depth + 1,
      );
      errors.push(...subResult.errors);
    } catch (error) {
      const msg = `Failed to download directory ${entry.name}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[Skill Ninja] ${msg}`);
      errors.push(msg);
      // サブディレクトリのエラーは致命的ではない - 続行
    }
  }

  return { errors };
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
  const token = await getGitHubToken();

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
          const result = await downloadDirectory(
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

          // サブディレクトリで部分的なエラーがあった場合は通知
          if (result.errors.length > 0) {
            console.warn(
              `[Skill Ninja] Partial errors during download:`,
              result.errors,
            );
            // SKILL.md が正常にダウンロードされていれば警告のみ
            const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
            try {
              const stat = await vscode.workspace.fs.stat(skillMdPath);
              if (stat.size > 100) {
                vscode.window.showWarningMessage(
                  isJapanese()
                    ? `スキル "${skill.name}" の一部のファイルがダウンロードできませんでした。SKILL.md は正常にインストールされています。`
                    : `Some files for skill "${skill.name}" could not be downloaded. SKILL.md was installed successfully.`,
                );
              }
            } catch {
              // SKILL.md 自体がない場合はフォールバック（上で処理済み）
            }
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
    try {
      await vscode.workspace.fs.stat(skillsPath);
    } catch {
      return [];
    }

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
  relativePath?: string; // ネストされたスキルのパス（例: "document-skills/docx"）
  // 公式仕様に基づくメタデータ
  license?: string; // ライセンス（例: MIT, Apache-2.0）
  author?: string; // 作成者
  version?: string; // バージョン
}

/**
 * ディレクトリ内のスキルを再帰的にスキャン
 * SKILL.md を持つフォルダをスキルとして検出
 * サブフォルダに SKILL.md がある場合は個別のスキルとして扱う
 */
async function scanSkillsRecursively(
  basePath: vscode.Uri,
  currentPath: vscode.Uri,
  relativePath: string,
  results: Array<{
    folderName: string;
    relativePath: string;
    metaPath: vscode.Uri;
    skillMdPath: vscode.Uri;
  }>,
  depth: number = 0,
): Promise<void> {
  // 最大深度を制限（無限ループ防止）
  if (depth > 3) return;

  try {
    try {
      await vscode.workspace.fs.stat(currentPath);
    } catch {
      return;
    }

    const entries = await vscode.workspace.fs.readDirectory(currentPath);
    const dirs = entries.filter(
      ([, type]) => type === vscode.FileType.Directory,
    );

    for (const [folderName] of dirs) {
      // 隠しフォルダはスキップ
      if (folderName.startsWith(".")) continue;

      const subPath = vscode.Uri.joinPath(currentPath, folderName);
      const skillMdPath = vscode.Uri.joinPath(subPath, "SKILL.md");
      const metaPath = vscode.Uri.joinPath(subPath, ".skill-meta.json");
      const subRelativePath = relativePath
        ? `${relativePath}/${folderName}`
        : folderName;

      // SKILL.md が存在するか確認
      let hasSkillMd = false;
      try {
        await vscode.workspace.fs.stat(skillMdPath);
        hasSkillMd = true;
      } catch {
        // SKILL.md がない
      }

      if (hasSkillMd) {
        // このフォルダはスキル
        results.push({
          folderName,
          relativePath: subRelativePath,
          metaPath,
          skillMdPath,
        });
        // スキルを検出したら、そのサブフォルダは再帰スキャンしない
        // （スキルの中にあるスキルは別のスキルとして扱わない）
        continue;
      }

      // サブフォルダも再帰的にスキャン（まだスキルが見つかっていない場合のみ）
      await scanSkillsRecursively(
        basePath,
        subPath,
        subRelativePath,
        results,
        depth + 1,
      );
    }
  } catch {
    // ディレクトリ読み取りエラー
  }
}

/**
 * インストール済みスキルのメタデータを再抽出（アップデート時用）
 * SKILL.md から description と whenToUse を再抽出してメタデータファイルを更新
 */
export async function refreshSkillMetadata(
  workspaceUri: vscode.Uri,
): Promise<number> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";
  const skillsPath = vscode.Uri.joinPath(workspaceUri, skillsDir);

  let updatedCount = 0;

  try {
    try {
      await vscode.workspace.fs.stat(skillsPath);
    } catch {
      return 0;
    }

    const entries = await vscode.workspace.fs.readDirectory(skillsPath);
    const dirs = entries.filter(
      ([, type]) => type === vscode.FileType.Directory,
    );

    for (const [folderName] of dirs) {
      const metaPath = vscode.Uri.joinPath(
        skillsPath,
        folderName,
        ".skill-meta.json",
      );
      const skillMdPath = vscode.Uri.joinPath(
        skillsPath,
        folderName,
        "SKILL.md",
      );

      try {
        // 既存のメタデータを読み込む
        const content = await vscode.workspace.fs.readFile(metaPath);
        const meta = JSON.parse(Buffer.from(content).toString("utf-8"));

        // SKILL.md から description と whenToUse を再抽出
        const newDescription = await extractDescriptionFromSkillMd(skillMdPath);
        const newWhenToUse = await extractWhenToUseFromSkillMd(skillMdPath);

        let updated = false;

        // description が変更された場合
        if (newDescription && meta.description !== newDescription) {
          meta.description = newDescription;
          updated = true;
        }

        // whenToUse が変更された場合
        // （customWhenToUse がある場合は whenToUse のみ更新、ユーザーのカスタム値は保持）
        if (meta.whenToUse !== newWhenToUse) {
          meta.whenToUse = newWhenToUse || undefined;
          updated = true;
        }

        if (updated) {
          // メタデータを保存
          await vscode.workspace.fs.writeFile(
            metaPath,
            Buffer.from(JSON.stringify(meta, null, 2), "utf-8"),
          );
          updatedCount++;
          console.log(`[Skill Ninja] Refreshed metadata for ${folderName}`);
        }
      } catch {
        // メタデータがない場合は新規作成
        try {
          const { name, description } =
            await extractNameAndDescriptionFromSkillMd(skillMdPath, folderName);
          const whenToUse = await extractWhenToUseFromSkillMd(skillMdPath);

          const newMeta: SkillMeta = {
            name,
            source: "unknown",
            description,
            whenToUse: whenToUse || undefined,
            categories: [],
            installedAt: new Date().toISOString(),
          };

          await vscode.workspace.fs.writeFile(
            metaPath,
            Buffer.from(JSON.stringify(newMeta, null, 2), "utf-8"),
          );
          updatedCount++;
          console.log(
            `[Skill Ninja] Created metadata for ${folderName}: ${whenToUse}`,
          );
        } catch {
          // SKILL.md もない場合はスキップ
        }
      }
    }
  } catch {
    // skills ディレクトリがない場合は何もしない
  }

  return updatedCount;
}

/**
 * 単一スキルのメタデータを SKILL.md から再抽出して更新
 * @param skillMdUri SKILL.md ファイルの URI
 * @returns 更新されたかどうか
 */
export async function refreshSingleSkillMetadata(
  skillMdUri: vscode.Uri,
): Promise<boolean> {
  // SKILL.md の親ディレクトリ（スキルフォルダ）を取得
  const skillPath = vscode.Uri.joinPath(skillMdUri, "..");
  const metaPath = vscode.Uri.joinPath(skillPath, ".skill-meta.json");

  try {
    // 既存のメタデータを読み込む
    const content = await vscode.workspace.fs.readFile(metaPath);
    const meta = JSON.parse(Buffer.from(content).toString("utf-8"));

    // SKILL.md から description と whenToUse を再抽出
    const newDescription = await extractDescriptionFromSkillMd(skillMdUri);
    const newWhenToUse = await extractWhenToUseFromSkillMd(skillMdUri);

    let updated = false;

    // description が変更された場合
    if (newDescription && meta.description !== newDescription) {
      meta.description = newDescription;
      updated = true;
    }

    // whenToUse が変更された場合
    if (meta.whenToUse !== newWhenToUse) {
      meta.whenToUse = newWhenToUse || undefined;
      updated = true;
    }

    if (updated) {
      await vscode.workspace.fs.writeFile(
        metaPath,
        Buffer.from(JSON.stringify(meta, null, 2), "utf-8"),
      );
      console.log(
        `[Skill Ninja] Updated metadata from SKILL.md: ${skillMdUri.fsPath}`,
      );
      return true;
    }

    return false;
  } catch {
    // メタデータがない場合は何もしない（インストールされていないスキル）
    return false;
  }
}

/**
 * インストール済みスキルのメタデータを取得
 * サブフォルダも再帰的にスキャンしてネストされたスキルも検出
 */
export async function getInstalledSkillsWithMeta(
  workspaceUri: vscode.Uri,
): Promise<SkillMeta[]> {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const skillsDir = config.get<string>("skillsDirectory") || ".github/skills";
  const skillsPath = vscode.Uri.joinPath(workspaceUri, skillsDir);

  try {
    try {
      await vscode.workspace.fs.stat(skillsPath);
    } catch {
      return [];
    }

    // 再帰的にスキルをスキャン
    const skillEntries: Array<{
      folderName: string;
      relativePath: string;
      metaPath: vscode.Uri;
      skillMdPath: vscode.Uri;
    }> = [];
    await scanSkillsRecursively(skillsPath, skillsPath, "", skillEntries);

    const metas: SkillMeta[] = [];
    for (const entry of skillEntries) {
      try {
        const content = await vscode.workspace.fs.readFile(entry.metaPath);
        const meta = JSON.parse(Buffer.from(content).toString("utf-8"));
        // relativePath を追加（メタデータにない場合）
        if (!meta.relativePath) {
          meta.relativePath = entry.relativePath;
        }
        metas.push(meta);
      } catch {
        // メタデータがない場合は SKILL.md から name と description を読み取る
        const { name, description, license, author, version } =
          await extractMetadataFromSkillMd(entry.skillMdPath, entry.folderName);
        // When to Use セクションも抽出
        const whenToUse = await extractWhenToUseFromSkillMd(entry.skillMdPath);
        metas.push({
          name,
          source: "unknown", // メタデータがない古い形式
          description,
          whenToUse: whenToUse || undefined,
          categories: [],
          installedAt: "",
          relativePath: entry.relativePath,
          license,
          author,
          version,
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
 * SKILL.md ファイルからメタデータを抽出する
 * frontmatter の name, description, license, metadata.author, metadata.version を読み取る
 */
async function extractMetadataFromSkillMd(
  skillMdUri: vscode.Uri,
  fallbackName: string,
): Promise<{
  name: string;
  description: string;
  license?: string;
  author?: string;
  version?: string;
}> {
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

      // license を抽出
      let license: string | undefined;
      const licenseMatch = frontmatter.match(/^license:\s*(.+)$/m);
      if (licenseMatch) {
        license = licenseMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      // metadata セクションから author と version を抽出
      let author: string | undefined;
      let version: string | undefined;

      // metadata.author または author を抽出
      const authorMatch = frontmatter.match(/^\s*author:\s*(.+)$/m);
      if (authorMatch) {
        author = authorMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      // metadata.version または version を抽出
      const versionMatch = frontmatter.match(/^\s*version:\s*(.+)$/m);
      if (versionMatch) {
        version = versionMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      return { name, description, license, author, version };
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
/**
 * SKILL.md ファイルから "When to Use" セクションを抽出する
 * 箇条書き・テーブル・段落形式に対応
 */
async function extractWhenToUseFromSkillMd(
  skillMdUri: vscode.Uri,
): Promise<string> {
  try {
    const content = await vscode.workspace.fs.readFile(skillMdUri);
    const text = Buffer.from(content).toString("utf-8");
    return parseWhenToUseFromText(text);
  } catch {
    return "";
  }
}

/**
 * テキストから "When to Use" セクションを抽出する（純粋関数・テスト可能）
 * @param text SKILL.md のテキスト内容
 * @returns 抽出された When to Use 文字列（最大200文字）
 */
export function parseWhenToUseFromText(text: string): string {
  // "When to Use" セクションを検出（英語・日本語対応）
  // 終了条件: 次の ## セクション、--- 区切り、または EOF
  // m フラグを使わず \n## で行頭をマッチさせる（$ がマルチラインで各行末にマッチするのを防ぐ）
  const sectionMatch = text.match(
    /\n##\s*(When to Use|When To Use|いつ使うか|使用タイミング|Usage|使い方)\s*\n([\s\S]*?)(?=\n##\s|\n---\n|\n*$)/i,
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

  const lines = sectionContent.split("\n");
  const extractedItems: string[] = [];

  // テーブル形式かどうかを検出（| で始まる行があるか）
  const hasTableLines = lines.some((line) => line.trim().startsWith("|"));

  if (hasTableLines) {
    // テーブル形式の場合：各行の全セルを結合（"キー: 値" 形式）
    for (const line of lines) {
      const trimmed = line.trim();

      // テーブル行でない場合はスキップ
      if (!trimmed.startsWith("|")) {
        continue;
      }

      // セパレータ行をスキップ（|---|---| のパターン）
      if (/^\|[\s\-:]+\|/.test(trimmed) && !trimmed.match(/[a-zA-Z0-9]/)) {
        continue;
      }

      // セルを抽出
      const cells = trimmed
        .split("|")
        .map(
          (c) =>
            c
              .trim()
              .replace(/\*\*/g, "") // bold マーカーを除去
              .replace(/`([^`]+)`/g, "$1"), // インラインコードを除去
        )
        .filter((c) => c.length > 0);

      if (cells.length > 0) {
        const firstCell = cells[0];

        // ヘッダーっぽい行はスキップ（Action, Triggers, Pattern 等）
        if (
          /^(action|trigger|pattern|use case|when|scenario|situation)s?$/i.test(
            firstCell,
          )
        ) {
          continue;
        }

        // 全セルを結合（2列以上の場合は "キー: 値" 形式）
        let rowContent = "";
        if (cells.length >= 2) {
          // 最初のセルが短い場合はキーとして使用（例: "Create: New .agent.md, ..."）
          if (firstCell.length <= 20) {
            rowContent = `${firstCell}: ${cells.slice(1).join(", ")}`;
          } else {
            // 全セルをカンマで結合
            rowContent = cells.join(", ");
          }
        } else {
          rowContent = firstCell;
        }

        if (rowContent) {
          extractedItems.push(rowContent);
        }
      }
    }
  } else {
    // リスト形式または段落形式の場合
    for (const line of lines) {
      const trimmed = line.trim();

      // リスト項目を検出（- や * や 数字. で始まる行）
      if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        // マーカーを除去して内容のみ取得
        const itemContent = trimmed
          .replace(/^[-*•]\s+/, "")
          .replace(/^\d+\.\s+/, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1"); // bold を除去
        extractedItems.push(itemContent);
      } else if (
        trimmed &&
        !trimmed.startsWith("#") &&
        extractedItems.length === 0
      ) {
        // 段落テキストの場合（リストがまだない場合）
        extractedItems.push(trimmed);
      }
    }
  }

  if (extractedItems.length === 0) {
    return "";
  }

  // 200文字以内で可能な限り多くの項目を結合
  const maxLength = 200;
  let result = "";
  let itemCount = 0;

  for (const item of extractedItems) {
    const separator = itemCount > 0 ? "; " : "";
    const candidate = result + separator + item;

    if (candidate.length <= maxLength) {
      result = candidate;
      itemCount++;
    } else if (itemCount === 0) {
      // 最初の項目すら入らない場合は切り詰め
      result = item.substring(0, maxLength - 3) + "...";
      break;
    } else {
      // これ以上入らないので終了
      break;
    }
  }

  return result;
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
