import {
  BROWSE_SORT_MODES,
  LOCAL_SORT_MODES,
  normalizeInvocationFilter,
  normalizeSortMode,
  type SkillViewOptions,
} from "./skillListOptions";
import type { SkillViewScope } from "./treeProvider";

interface ViewState {
  get(key: string): unknown;
  update(key: string, value: SkillViewOptions): PromiseLike<void>;
}

const LEGACY_FILTER = "skillNinja.invocationFilter";
const keys: Record<SkillViewScope, string> = {
  local: "skillNinja.viewOptions.local",
  browse: "skillNinja.viewOptions.browse",
};

function isOptions(value: unknown): value is Partial<SkillViewOptions> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createSkillViewOptionsState(
  profile: ViewState,
  workspace: Pick<ViewState, "get">,
) {
  function save(scope: SkillViewScope, options: SkillViewOptions) {
    return profile.update(keys[scope], options);
  }

  return {
    save,
    restore(scope: SkillViewScope): SkillViewOptions {
      const key = keys[scope];
      const stored = profile.get(key);
      const workspaceValue = stored === undefined ? workspace.get(key) : undefined;
      const legacy =
        stored === undefined && scope === "local"
          ? workspace.get(LEGACY_FILTER)
          : undefined;
      const value = stored ?? workspaceValue;
      return {
        filter: normalizeInvocationFilter(
          (isOptions(value) ? value.filter : undefined) ?? legacy,
        ),
        sort: normalizeSortMode(
          isOptions(value) ? value.sort : undefined,
          scope === "local" ? LOCAL_SORT_MODES : BROWSE_SORT_MODES,
        ),
      };
    },
    migrate(scope: SkillViewScope, options: SkillViewOptions) {
      if (profile.get(keys[scope]) !== undefined) {
        return;
      }
      if (options.filter !== "all" || options.sort !== "default") {
        return save(scope, options);
      }
    },
  };
}
