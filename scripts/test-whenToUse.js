/**
 * parseWhenToUseFromText 関数のテスト
 * 実行: node scripts/test-whenToUse.js
 */

// TypeScript からロジックをコピー（テスト用の純粋JS版）
function parseWhenToUseFromText(text) {
  const normalizedText = text.replace(/\r\n/g, "\n");
  // "When to Use" セクションを検出（英語・日本語対応）
  // 終了条件: 次の ## セクション、--- 区切り、または EOF
  // m フラグを使わず \n## で行頭をマッチさせる
  const sectionMatch = normalizedText.match(
    /\n##\s*(When to Use|When To Use|いつ使うか|使用タイミング|Usage|使い方)\s*\n([\s\S]*?)(?=\n##\s|\n---\n|\n*$)/i,
  );

  let sectionContent = "";

  if (sectionMatch) {
    sectionContent = sectionMatch[2].trim();
  } else {
    // フォールバック: # タイトルの次の段落を抽出
    let bodyText = normalizedText;
    const frontmatterMatch = normalizedText.match(/^---\n[\s\S]*?\n---\n*/);
    if (frontmatterMatch) {
      bodyText = normalizedText.substring(frontmatterMatch[0].length);
    }

    const lines = bodyText.split("\n");
    let foundTitle = false;
    const paragraphLines = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (!foundTitle) {
        if (/^#\s+/.test(trimmed)) {
          foundTitle = true;
        }
        continue;
      }

      if (!trimmed) {
        if (paragraphLines.length > 0) {
          break;
        }
        continue;
      }

      if (/^#/.test(trimmed)) {
        break;
      }

      if (/^```/.test(trimmed) || /^[-*]\s+\*\*/.test(trimmed)) {
        break;
      }

      paragraphLines.push(trimmed);

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
  const extractedItems = [];

  const hasTableLines = lines.some((line) => line.trim().startsWith("|"));

  if (hasTableLines) {
    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed.startsWith("|")) {
        continue;
      }

      if (/^\|[\s\-:]+\|/.test(trimmed) && !trimmed.match(/[a-zA-Z0-9]/)) {
        continue;
      }

      const cells = trimmed
        .split("|")
        .map((c) =>
          c
            .trim()
            .replace(/\*\*/g, "")
            .replace(/`([^`]+)`/g, "$1"),
        )
        .filter((c) => c.length > 0);

      if (cells.length > 0) {
        const firstCell = cells[0];

        if (
          /^(action|trigger|pattern|use case|when|scenario|situation)s?$/i.test(
            firstCell,
          )
        ) {
          continue;
        }

        let rowContent = "";
        if (cells.length >= 2) {
          if (firstCell.length <= 20) {
            rowContent = `${firstCell}: ${cells.slice(1).join(", ")}`;
          } else {
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
    for (const line of lines) {
      const trimmed = line.trim();

      if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        const itemContent = trimmed
          .replace(/^[-*•]\s+/, "")
          .replace(/^\d+\.\s+/, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1");
        extractedItems.push(itemContent);
      } else if (
        trimmed &&
        !trimmed.startsWith("#") &&
        extractedItems.length === 0
      ) {
        extractedItems.push(trimmed);
      }
    }
  }

  if (extractedItems.length === 0) {
    return "";
  }

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
      result = item.substring(0, maxLength - 3) + "...";
      break;
    } else {
      break;
    }
  }

  return result;
}

// ========================
// テストケース
// ========================

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message || "Assertion failed"}\n  Expected: "${expected}"\n  Actual:   "${actual}"`,
    );
  }
}

function assertIncludes(actual, substring, message) {
  if (!actual.includes(substring)) {
    throw new Error(
      `${message || "Assertion failed"}\n  Expected to include: "${substring}"\n  Actual: "${actual}"`,
    );
  }
}

function assertMaxLength(actual, maxLen, message) {
  if (actual.length > maxLen) {
    throw new Error(
      `${message || "Length exceeded"}\n  Max: ${maxLen}\n  Actual: ${actual.length} ("${actual.substring(0, 50)}...")`,
    );
  }
}

// ========================
// 1. 箇条書き形式（基本）
// ========================
test("test_bulletList_simpleItems_returnsJoined", () => {
  const input = `# My Skill

## When to Use

- Item one
- Item two
- Item three
`;
  const result = parseWhenToUseFromText(input);
  assertEqual(result, "Item one; Item two; Item three");
});

// ========================
// 2. 箇条書き形式（bold付き）
// ========================
test("test_bulletList_withBold_removesBoldMarkers", () => {
  const input = `# My Skill

## When to Use

- **New Workflow Design** - Define agent roles
- **Workflow Review** - Detect issues
`;
  const result = parseWhenToUseFromText(input);
  assertIncludes(result, "New Workflow Design");
  assertIncludes(result, "Workflow Review");
  // bold マーカーが除去されている
  assertEqual(result.includes("**"), false, "Should not contain bold markers");
});

// ========================
// 3. 箇条書き形式（200文字以内で全部入る）
// ========================
test("test_bulletList_underMaxLength_includesAllItems", () => {
  const input = `# Skill

## When to Use

- Short A
- Short B
- Short C
- Short D
- Short E
`;
  const result = parseWhenToUseFromText(input);
  assertEqual(result, "Short A; Short B; Short C; Short D; Short E");
});

// ========================
// 4. 箇条書き形式（200文字超え）
// ========================
test("test_bulletList_overMaxLength_truncatesWithinLimit", () => {
  const longItem = "A".repeat(50);
  const input = `# Skill

## When to Use

- ${longItem}
- ${longItem}
- ${longItem}
- ${longItem}
- ${longItem}
`;
  const result = parseWhenToUseFromText(input);
  assertMaxLength(result, 200, "Should not exceed 200 characters");
  // 最初の3項目は入るはず（50*3 + 4 = 154）
  assertIncludes(result, longItem);
});

// ========================
// 5. テーブル形式（全セル結合）
// ========================
test("test_tableFormat_basic_combinesAllCells", () => {
  const input = `# Skill

## When to Use

| Action | Description |
|--------|-------------|
| Create files | Make new files |
| Edit code | Modify existing |
| Run tests | Execute test suite |
`;
  const result = parseWhenToUseFromText(input);
  // 新しいロジック: 全セルを "key: value" 形式で結合
  assertEqual(
    result,
    "Create files: Make new files; Edit code: Modify existing; Run tests: Execute test suite",
  );
});

// ========================
// 6. テーブル形式（ヘッダースキップ）
// ========================
test("test_tableFormat_headerRow_skipsHeader", () => {
  const input = `# Skill

## When to Use

| Action | Triggers |
|--------|----------|
| Deploy | On push to main |
| Build | On PR creation |
`;
  const result = parseWhenToUseFromText(input);
  // "Action" はヘッダーとしてスキップされる
  assertEqual(result.includes("Action"), false, "Should skip Action header");
  assertIncludes(result, "Deploy");
  assertIncludes(result, "Build");
});

// ========================
// 7. テーブル形式（セパレータのみスキップ）
// ========================
test("test_tableFormat_separatorRow_skipsSeparator", () => {
  const input = `# Skill

## When to Use

| Item | Desc |
|:-----|:-----|
| First | Info |
`;
  const result = parseWhenToUseFromText(input);
  // セパレータ行は含まれない
  assertEqual(result.includes("---"), false, "Should not contain separator");
  assertIncludes(result, "First");
});

// ========================
// 8. 日本語セクション見出し
// ========================
test("test_japaneseSection_itsukaukuka_works", () => {
  const input = `# スキル

## いつ使うか

- 新規ワークフロー設計時
- レビュー時
`;
  const result = parseWhenToUseFromText(input);
  assertIncludes(result, "新規ワークフロー設計時");
  assertIncludes(result, "レビュー時");
});

// ========================
// 9. 日本語セクション（使用タイミング）
// ========================
test("test_japaneseSection_shiyouTiming_works", () => {
  const input = `# スキル

## 使用タイミング

- パターン選択時
- 品質改善時
`;
  const result = parseWhenToUseFromText(input);
  assertIncludes(result, "パターン選択時");
});

// ========================
// 10. セクションなし（フォールバック：タイトル後段落）
// ========================
test("test_noWhenToUse_fallback_extractsTitleParagraph", () => {
  const input = `# My Awesome Skill

This skill helps you do amazing things with code.

## Features

- Feature one
`;
  const result = parseWhenToUseFromText(input);
  assertIncludes(result, "This skill helps you do amazing things");
});

// ========================
// 11. フロントマター付きフォールバック
// ========================
test("test_withFrontmatter_fallback_skipsFrontmatter", () => {
  const input = `---
name: test-skill
description: A test skill
---

# Test Skill

Use this for testing purposes.

## Details
`;
  const result = parseWhenToUseFromText(input);
  assertIncludes(result, "Use this for testing purposes");
  // frontmatter の内容は含まれない
  assertEqual(
    result.includes("name:"),
    false,
    "Should not contain frontmatter",
  );
});

// ========================
// 11b. CRLF 改行でも動作
// ========================
test("test_withCRLF_newlines_supported", () => {
  const input =
    "---\r\nname: test-skill\r\ndescription: A test skill\r\n---\r\n\r\n# Test Skill\r\n\r\n## When to Use\r\n\r\n- Item one\r\n- Item two\r\n";
  const result = parseWhenToUseFromText(input);
  assertEqual(result, "Item one; Item two");
});

// ========================
// 12. 空のWhen to Useセクション
// ========================
test("test_emptyWhenToUse_returnsEmpty", () => {
  const input = `# Skill

## When to Use

## Next Section
`;
  const result = parseWhenToUseFromText(input);
  assertEqual(result, "");
});

// ========================
// 13. 番号付きリスト
// ========================
test("test_numberedList_extractsItems", () => {
  const input = `# Skill

## When to Use

1. First thing to do
2. Second thing
3. Third thing
`;
  const result = parseWhenToUseFromText(input);
  assertIncludes(result, "First thing to do");
  assertIncludes(result, "Second thing");
  assertIncludes(result, "Third thing");
});

// ========================
// 14. 段落形式（リストなし）
// ========================
test("test_paragraphOnly_extractsParagraph", () => {
  const input = `# Skill

## When to Use

Use this skill whenever you need to process data files.
`;
  const result = parseWhenToUseFromText(input);
  assertIncludes(
    result,
    "Use this skill whenever you need to process data files",
  );
});

// ========================
// 15. 最初の項目が200文字超え
// ========================
test("test_firstItemTooLong_truncatesWithEllipsis", () => {
  const veryLong = "X".repeat(250);
  const input = `# Skill

## When to Use

- ${veryLong}
`;
  const result = parseWhenToUseFromText(input);
  assertMaxLength(result, 200, "Should truncate to 200 chars");
  assertEqual(result.endsWith("..."), true, "Should end with ellipsis");
});

// ========================
// 16. Usage セクション（代替見出し）
// ========================
test("test_usageSection_alternativeHeading_works", () => {
  const input = `# Tool

## Usage

- Configure settings
- Run the tool
`;
  const result = parseWhenToUseFromText(input);
  assertIncludes(result, "Configure settings");
  assertIncludes(result, "Run the tool");
});

// ========================
// 17. 実際の agentic-workflow-guide 形式
// ========================
test("test_realWorld_agenticWorkflowGuide_extractsList", () => {
  const input = `---
name: agentic-workflow-guide
description: "Design, review, and improve agent workflows."
---

# Agentic Workflow Guide

A comprehensive guide for designing agent workflows.

## When to Use

- **New Workflow Design** - Define agent roles, responsibilities, and execution order
- **Workflow Review** - Detect issues by checking against design principles
- **Pattern Selection** - Choose the right workflow pattern for your task
- **Quality Improvement** - Iteratively refine workflows step by step
- **Scaffolding** - Generate workflow directory structures and templates
- **Long-Horizon Tasks** - Manage context for multi-hour agent sessions

## Core Principles
`;
  const result = parseWhenToUseFromText(input);
  assertIncludes(result, "New Workflow Design");
  assertIncludes(result, "Workflow Review");
  assertMaxLength(result, 200);
});

// ========================
// 18. テーブル形式で複数列（全列結合）
// ========================
test("test_tableFormat_multiColumn_combinesAllColumns", () => {
  const input = `# Skill

## When to Use

| Scenario | Input | Output |
|----------|-------|--------|
| Create report | Data file | PDF |
| Analyze data | CSV | Charts |
`;
  const result = parseWhenToUseFromText(input);
  // 新しいロジック: 全列を結合
  assertEqual(
    result,
    "Create report: Data file, PDF; Analyze data: CSV, Charts",
  );
});

// ========================
// テスト実行
// ========================
console.log("🥷 parseWhenToUseFromText テスト\n");
console.log("=".repeat(50));

for (const t of tests) {
  try {
    t.fn();
    passed++;
    console.log(`✅ ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`❌ ${t.name}`);
    console.log(`   ${e.message.split("\n").join("\n   ")}`);
  }
}

console.log("=".repeat(50));
console.log(`\n結果: ${passed} passed, ${failed} failed`);

// 実際のスキルでのテスト（--real オプション）
if (process.argv.includes("--real")) {
  const fs = require("fs");
  const path = require("path");
  const skillsDir = ".github/skills";

  console.log("\n" + "=".repeat(50));
  console.log("=== 実際のスキル抽出結果 ===\n");

  try {
    const skills = fs
      .readdirSync(skillsDir)
      .filter((f) => fs.statSync(path.join(skillsDir, f)).isDirectory());

    for (const skill of skills) {
      const skillMdPath = path.join(skillsDir, skill, "SKILL.md");
      try {
        const text = fs.readFileSync(skillMdPath, "utf8");
        const whenToUse = parseWhenToUseFromText(text);
        console.log(`${skill} (${whenToUse.length}文字):`);
        console.log(`  ${whenToUse || "(empty)"}`);
        console.log("");
      } catch {
        console.log(`${skill}: (no SKILL.md)`);
      }
    }
  } catch {
    console.log("スキルディレクトリが見つかりません");
  }
}

if (failed > 0) {
  process.exit(1);
}
