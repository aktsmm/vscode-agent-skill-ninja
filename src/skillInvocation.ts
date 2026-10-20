// SKILL.md の呼び出しモード（frontmatter の disable-model-invocation / user-invocable）を扱う。
// vscode に依存しない純粋関数だけを置き、スキャナ・インストーラ・出力生成・テストが同じ実装を使う。

/**
 * - auto: モデルも `/name` も使える（既定）
 * - explicitOnly: `disable-model-invocation: true`。`/name` での明示呼び出し専用
 * - modelOnly: `user-invocable: false`。スラッシュメニューに出さず、モデルだけが使う
 */
export type SkillInvocation = "auto" | "explicitOnly" | "modelOnly";

export const DISABLE_MODEL_INVOCATION_KEY = "disable-model-invocation";
export const USER_INVOCABLE_KEY = "user-invocable";

interface FrontmatterLine {
  text: string;
  eol: string;
}

interface FrontmatterRange {
  lines: FrontmatterLine[];
  closeIndex: number;
}

function toLines(text: string): FrontmatterLine[] {
  const parts = text.split(/(\r?\n)/);
  const lines: FrontmatterLine[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    lines.push({ text: parts[index], eol: parts[index + 1] ?? "" });
  }
  return lines;
}

function joinLines(lines: FrontmatterLine[]): string {
  return lines.map((line) => line.text + line.eol).join("");
}

function locateFrontmatter(text: string): FrontmatterRange | undefined {
  const lines = toLines(text);
  if (lines[0]?.text.replace(/^\uFEFF/, "").trim() !== "---") {
    return undefined;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].text.trimEnd() === "---") {
      return { lines, closeIndex: index };
    }
  }
  return undefined;
}

const TOP_LEVEL_KEY = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/;

function parseBoolean(rawValue: string): boolean | undefined {
  const value = rawValue
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2")
    .toLowerCase();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

/** 両方のキーが立っている場合は、誰も自動では使わない explicitOnly を優先する。 */
export function resolveSkillInvocation(flags: {
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
}): SkillInvocation {
  if (flags.disableModelInvocation === true) {
    return "explicitOnly";
  }
  if (flags.userInvocable === false) {
    return "modelOnly";
  }
  return "auto";
}

/**
 * 既にパース済みの frontmatter 値（引用符・コメント除去済み）から呼び出しモードを決める。
 * リモートスキルのインデックス生成が、ローカル走査と同じ判定規則を使うための入口。
 */
export function resolveSkillInvocationFromValues(values: {
  disableModelInvocation?: string;
  userInvocable?: string;
}): SkillInvocation {
  return resolveSkillInvocation({
    disableModelInvocation: parseBoolean(values.disableModelInvocation ?? ""),
    userInvocable: parseBoolean(values.userInvocable ?? ""),
  });
}

/** `context: fork`（サブエージェントで実行）だけを認識する。実験的機能なので他の値は無視する。 */
export type SkillExecutionContext = "fork";

export function parseSkillExecutionContext(
  value: string | undefined,
): SkillExecutionContext | undefined {
  return value?.trim().toLowerCase() === "fork" ? "fork" : undefined;
}

export function readSkillInvocationFromText(text: string): SkillInvocation {
  const range = locateFrontmatter(text);
  if (!range) {
    return "auto";
  }

  const flags: { disableModelInvocation?: boolean; userInvocable?: boolean } =
    {};
  for (let index = 1; index < range.closeIndex; index += 1) {
    const match = range.lines[index].text.match(TOP_LEVEL_KEY);
    if (!match) {
      continue;
    }
    if (match[1] === DISABLE_MODEL_INVOCATION_KEY) {
      flags.disableModelInvocation = parseBoolean(match[2]);
    } else if (match[1] === USER_INVOCABLE_KEY) {
      flags.userInvocable = parseBoolean(match[2]);
    }
  }
  return resolveSkillInvocation(flags);
}

export function normalizeSkillInvocation(value: unknown): SkillInvocation {
  return value === "explicitOnly" || value === "modelOnly" ? value : "auto";
}

export function getInvocationLabelText(
  invocation: unknown,
  isJa: boolean,
): string {
  switch (normalizeSkillInvocation(invocation)) {
    case "explicitOnly":
      return isJa ? "手動専用" : "Manual only";
    case "modelOnly":
      return isJa ? "モデル専用" : "Model only";
    default:
      return isJa ? "自動" : "Auto";
  }
}

/** 手動専用 / モデル専用を一覧で見分けるための codicon id。通常スキルは fallback を使う。 */
export function getInvocationIconId(
  invocation: unknown,
  fallback: string,
): string {
  switch (normalizeSkillInvocation(invocation)) {
    case "explicitOnly":
      return "play-circle";
    case "modelOnly":
      return "hubot";
    default:
      return fallback;
  }
}

/** 手動専用スキルを生成する一覧へ載せる方法（skillNinja.explicitOnlySkillsInInstructions）。 */
export type ExplicitOnlyHandling = "exclude" | "separate" | "include";

export function normalizeExplicitOnlyHandling(
  value: unknown,
): ExplicitOnlyHandling {
  return value === "separate" || value === "include" ? value : "exclude";
}

const DESIRED_FRONTMATTER: Record<
  SkillInvocation,
  Array<[key: string, value: string | null]>
> = {
  auto: [
    [DISABLE_MODEL_INVOCATION_KEY, null],
    [USER_INVOCABLE_KEY, null],
  ],
  explicitOnly: [
    [DISABLE_MODEL_INVOCATION_KEY, "true"],
    [USER_INVOCABLE_KEY, null],
  ],
  modelOnly: [
    [DISABLE_MODEL_INVOCATION_KEY, null],
    [USER_INVOCABLE_KEY, "false"],
  ],
};

/**
 * frontmatter の該当キーだけを差し替える。他の行・改行コード・コメントには触れない。
 * frontmatter が無い、または閉じていない場合は何も書けないので undefined を返す。
 */
export function setSkillInvocationInText(
  text: string,
  invocation: SkillInvocation,
): string | undefined {
  const range = locateFrontmatter(text);
  if (!range) {
    return undefined;
  }

  const { lines } = range;
  let closeIndex = range.closeIndex;
  // 追記する行は、開き `---` と同じ改行コードに揃える
  const eol = lines[0].eol || "\n";

  for (const [key, value] of DESIRED_FRONTMATTER[invocation]) {
    const matches: number[] = [];
    for (let index = 1; index < closeIndex; index += 1) {
      if (lines[index].text.match(TOP_LEVEL_KEY)?.[1] === key) {
        matches.push(index);
      }
    }

    if (value === null) {
      for (const index of matches.reverse()) {
        lines.splice(index, 1);
        closeIndex -= 1;
      }
      continue;
    }

    const nextText = `${key}: ${value}`;
    if (matches.length === 0) {
      lines.splice(closeIndex, 0, { text: nextText, eol });
      closeIndex += 1;
      continue;
    }

    const [first, ...duplicates] = matches;
    const currentValue = parseBoolean(
      lines[first].text.replace(TOP_LEVEL_KEY, "$2"),
    );
    if (currentValue !== (value === "true")) {
      lines[first] = { text: nextText, eol: lines[first].eol };
    }
    for (const index of duplicates.reverse()) {
      lines.splice(index, 1);
      closeIndex -= 1;
    }
  }

  return joinLines(lines);
}
