// Installed / User-Global / Browse 共通の「絞り込みと並べ替え」ピッカー。
// 選ぶたびに反映し、開いたまま続けて別の項目も変えられるようにする。

import * as vscode from "vscode";
import { messages } from "./i18n";
import {
  BROWSE_SORT_MODES,
  LOCAL_SORT_MODES,
  normalizeSortMode,
  type SkillInvocationFilter,
  type SkillSortMode,
  type SkillViewOptions,
} from "./skillListOptions";
import { getInvocationLabel, type SkillViewScope } from "./treeProvider";

const FILTERS: readonly SkillInvocationFilter[] = [
  "all",
  "auto",
  "explicitOnly",
  "modelOnly",
];

export function getSortModes(scope: SkillViewScope): readonly SkillSortMode[] {
  return scope === "browse" ? BROWSE_SORT_MODES : LOCAL_SORT_MODES;
}

function getFilterLabel(filter: SkillInvocationFilter): string {
  return filter === "all"
    ? messages.invocationFilterAll()
    : getInvocationLabel(filter);
}

function getSortLabel(scope: SkillViewScope, mode: SkillSortMode): string {
  switch (mode) {
    case "name":
      return messages.sortName();
    case "stars":
      return messages.sortStars();
    case "invocation":
      return messages.sortInvocation();
    default:
      return scope === "browse"
        ? messages.sortDefaultBrowse()
        : messages.sortDefaultLocal();
  }
}

/** ビュー上部に出す「今こう絞っている」表示。既定のままなら undefined（何も出さない）。 */
export function describeViewOptions(
  scope: SkillViewScope,
  options: SkillViewOptions,
): string | undefined {
  const parts: string[] = [];
  if (options.filter !== "all") {
    parts.push(messages.viewOptionsFilterPart(getFilterLabel(options.filter)));
  }
  const sort = normalizeSortMode(options.sort, getSortModes(scope));
  if (sort !== "default") {
    parts.push(messages.viewOptionsSortPart(getSortLabel(scope, sort)));
  }
  return parts.length > 0
    ? messages.viewOptionsActiveMessage(parts.join(" / "))
    : undefined;
}

type OptionItem = vscode.QuickPickItem &
  (
    | { kind?: vscode.QuickPickItemKind.Default; filter: SkillInvocationFilter }
    | { kind?: vscode.QuickPickItemKind.Default; sort: SkillSortMode }
    | { kind: vscode.QuickPickItemKind.Separator }
  );

function radio(selected: boolean): string {
  return selected ? "$(pass-filled)" : "$(circle-large-outline)";
}

function buildItems(
  scope: SkillViewScope,
  options: SkillViewOptions,
): OptionItem[] {
  const items: OptionItem[] = [
    {
      label: messages.viewOptionsFilterHeading(),
      kind: vscode.QuickPickItemKind.Separator,
    },
  ];
  for (const filter of FILTERS) {
    const selected = options.filter === filter;
    items.push({
      label: `${radio(selected)} ${getFilterLabel(filter)}`,
      // アイコンだけに頼らず、選択中であることを文字でも示す
      description: selected ? messages.viewOptionsSelected() : "",
      filter,
    });
  }
  items.push({
    label: messages.viewOptionsSortHeading(),
    kind: vscode.QuickPickItemKind.Separator,
  });
  for (const sort of getSortModes(scope)) {
    const selected = options.sort === sort;
    items.push({
      label: `${radio(selected)} ${getSortLabel(scope, sort)}`,
      description: selected ? messages.viewOptionsSelected() : "",
      detail:
        sort === "invocation" ? messages.sortInvocationDetail() : undefined,
      sort,
    });
  }
  return items;
}

export function showSkillViewOptionsPicker(
  scope: SkillViewScope,
  initial: SkillViewOptions,
  onChange: (next: SkillViewOptions) => void | Promise<void>,
): Promise<void> {
  let current: SkillViewOptions = {
    filter: initial.filter,
    sort: normalizeSortMode(initial.sort, getSortModes(scope)),
  };
  const picker = vscode.window.createQuickPick<OptionItem>();
  picker.title = messages.viewOptionsTitle();
  picker.placeholder = messages.viewOptionsPlaceholder();
  picker.matchOnDescription = false;

  const render = (focus?: OptionItem) => {
    picker.items = buildItems(scope, current);
    // 反映後も選んだ項目にカーソルを残し、続けて操作しやすくする
    const target = picker.items.find(
      (item) =>
        focus !== undefined &&
        (("filter" in focus &&
          "filter" in item &&
          item.filter === focus.filter) ||
          ("sort" in focus && "sort" in item && item.sort === focus.sort)),
    );
    picker.activeItems = target ? [target] : [];
  };
  render({ label: "", filter: current.filter });

  return new Promise<void>((resolve) => {
    picker.onDidAccept(async () => {
      const selected = picker.selectedItems[0];
      if (!selected) {
        return;
      }
      const next: SkillViewOptions =
        "filter" in selected
          ? { ...current, filter: selected.filter }
          : "sort" in selected
            ? { ...current, sort: selected.sort }
            : current;
      if (next.filter === current.filter && next.sort === current.sort) {
        return;
      }
      current = next;
      render(selected);
      await onChange(next);
    });
    picker.onDidHide(() => {
      picker.dispose();
      resolve();
    });
    picker.show();
  });
}
