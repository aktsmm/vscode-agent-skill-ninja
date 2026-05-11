// Coexistence layer for Agent Skills Ninja.
//
// Implements Capability Beacon + Single Block / Owner Handoff (protocol v3).
// Sister extension: Agent Resources Ninja (yamapan.agent-resources-ninja).
//
// IMPORTANT:
// - The owner-decision algorithm in `computeOwnership` MUST be identical
//   between Skill NINJA and Resource NINJA. Do not diverge without bumping
//   `BEACON_PROTOCOL_VERSION`.
// - When sibling is absent, this extension behaves as before (single-extension
//   path), so single-user behavior is fully preserved.
//
// IPC NOTE (v3.1):
// VS Code's `globalState` is per-extension and NOT shared across extensions.
// Sibling beacons are exchanged via the `extension.exports` API:
//   `vscode.extensions.getExtension(SIBLING_ID).activate()` resolves to the
//   `AgentNinjaExtensionApi` returned from the sibling's `activate()` function.
// We still publish to our own globalState for diagnostics (so
// `showCoexistenceStatus` can show what we last published), but the
// authoritative read path is the exports API.

import * as vscode from "vscode";

export const SELF_EXTENSION_ID = "yamapan.agent-skill-ninja";
export const SIBLING_EXTENSION_ID = "yamapan.agent-resources-ninja";

export const BEACON_KEY_PREFIX = "agentNinja.beacon.";
export const BEACON_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const MIGRATION_GUARD_DELAY_MS = 200;
export const BEACON_PROTOCOL_VERSION = 3;

// Resource kinds. Order is informative only; comparisons use Set semantics.
export type ResourceKind =
  | "skill"
  | "agent"
  | "instruction"
  | "prompt"
  | "hook"
  | "mcp"
  | "plugin"
  | "cursor-rule";

// Skill NINJA only owns the "skill" kind.
export const SELF_KINDS: ReadonlyArray<ResourceKind> = ["skill"];

// Best-effort fallback used only when sibling is installed but its exports
// API has not yet returned a beacon (race window during simultaneous
// activation, or sibling running an older version that doesn't expose the
// API). Conservatively assume the sibling covers a strict superset so that
// we defer until its real beacon arrives.
export const SIBLING_KINDS_FALLBACK: ReadonlyArray<ResourceKind> = [
  "skill",
  "agent",
  "instruction",
  "prompt",
  "hook",
  "mcp",
  "plugin",
  "cursor-rule",
];

export type CoexistenceMode = "auto" | "independent";

export interface AgentNinjaBeacon {
  extensionId: string;
  version: string;
  kinds: ResourceKind[];
  capabilities: string[];
  protocolVersion: number;
  updatedAt: string; // ISO 8601
  pid?: number;
}

/**
 * The shape both extensions return from their `activate()` function. The
 * sibling consumes this via `vscode.extensions.getExtension(...).activate()`.
 *
 * Keep this strictly read-only and synchronous — `getAgentNinjaBeacon` runs
 * inside the sibling's activation chain, so it must not perform I/O.
 */
export interface AgentNinjaExtensionApi {
  getAgentNinjaBeacon(): AgentNinjaBeacon | undefined;
}

export type Ownership = "self" | "sibling";

export interface OwnershipDecision {
  owner: Ownership;
  reason:
    | "no-sibling"
    | "self-superset"
    | "sibling-superset"
    | "tiebreak"
    | "independent";
  selfKinds: ResourceKind[];
  siblingKinds?: ResourceKind[];
  siblingBeacon?: AgentNinjaBeacon;
  siblingInstalled: boolean;
}

interface BeaconStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

function getStorage(context: vscode.ExtensionContext): BeaconStorage {
  return context.globalState as unknown as BeaconStorage;
}

function selfBeaconKey(): string {
  return `${BEACON_KEY_PREFIX}${SELF_EXTENSION_ID}`;
}

function getSelfVersion(): string {
  const ext = vscode.extensions.getExtension(SELF_EXTENSION_ID);
  return (ext?.packageJSON?.version as string) || "0.0.0";
}

/**
 * Construct the beacon describing this extension. Pure / synchronous so it
 * can be returned from the exports API without any I/O.
 */
export function buildSelfBeacon(): AgentNinjaBeacon {
  return {
    extensionId: SELF_EXTENSION_ID,
    version: getSelfVersion(),
    kinds: [...SELF_KINDS],
    capabilities: ["owner-handoff-v3"],
    protocolVersion: BEACON_PROTOCOL_VERSION,
    updatedAt: new Date().toISOString(),
    pid: typeof process !== "undefined" ? process.pid : undefined,
  };
}

// Cached beacon for the lifetime of this activation. Updated on each
// publishBeacon() call so the exports API reflects the latest snapshot.
let lastPublishedBeacon: AgentNinjaBeacon | undefined;

/**
 * Build, cache, and persist the current beacon. Called from `activate()`.
 * The globalState write is for diagnostics only; sibling extensions read
 * via the exports API (see `getSiblingBeaconApi`).
 */
export async function publishBeacon(
  context: vscode.ExtensionContext,
): Promise<AgentNinjaBeacon> {
  const beacon = buildSelfBeacon();
  lastPublishedBeacon = beacon;
  await getStorage(context).update(selfBeaconKey(), beacon);
  return beacon;
}

/**
 * Get the most recently published beacon for this extension. Synchronous so
 * it can be returned from the exports API. Falls back to a fresh beacon if
 * `publishBeacon` has not been called yet (e.g. sibling reads us before
 * our activation finishes).
 */
export function getSelfBeacon(): AgentNinjaBeacon {
  return lastPublishedBeacon ?? buildSelfBeacon();
}

/**
 * Build the exports object returned from `activate()`. Sibling extensions
 * read this via `vscode.extensions.getExtension(SELF_ID).activate()`.
 */
export function buildExtensionApi(): AgentNinjaExtensionApi {
  return {
    getAgentNinjaBeacon: () => getSelfBeacon(),
  };
}

/**
 * Read the diagnostic copy of our own beacon from globalState. Used by the
 * status command; not used for owner decision.
 */
export function getPublishedSelfBeacon(
  context: vscode.ExtensionContext,
): AgentNinjaBeacon | undefined {
  const raw = getStorage(context).get<AgentNinjaBeacon>(selfBeaconKey());
  return normalizeBeacon(raw, Date.now());
}

/**
 * Clear our beacon. Called from `deactivate()`. Note: VS Code does not
 * reliably call deactivate on uninstall, so readers must rely on TTL + the
 * extensions API as well.
 */
export async function clearBeacon(
  context: vscode.ExtensionContext,
): Promise<void> {
  lastPublishedBeacon = undefined;
  await getStorage(context).update(selfBeaconKey(), undefined);
}

function isExpired(beacon: AgentNinjaBeacon, nowMs: number): boolean {
  const updatedMs = Date.parse(beacon.updatedAt);
  if (Number.isNaN(updatedMs)) {
    return true;
  }
  return nowMs - updatedMs > BEACON_TTL_MS;
}

function isValidKind(value: unknown): value is ResourceKind {
  return (
    value === "skill" ||
    value === "agent" ||
    value === "instruction" ||
    value === "prompt" ||
    value === "hook" ||
    value === "mcp" ||
    value === "plugin" ||
    value === "cursor-rule"
  );
}

function normalizeBeacon(
  raw: unknown,
  nowMs: number,
): AgentNinjaBeacon | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<AgentNinjaBeacon>;
  if (
    typeof candidate.extensionId !== "string" ||
    typeof candidate.version !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    !Array.isArray(candidate.kinds) ||
    !candidate.kinds.every(isValidKind) ||
    !Array.isArray(candidate.capabilities)
  ) {
    return undefined;
  }
  if (isExpired(candidate as AgentNinjaBeacon, nowMs)) {
    return undefined;
  }
  return {
    extensionId: candidate.extensionId,
    version: candidate.version,
    kinds: [...candidate.kinds],
    capabilities: candidate.capabilities.filter(
      (cap): cap is string => typeof cap === "string",
    ),
    protocolVersion:
      typeof candidate.protocolVersion === "number"
        ? candidate.protocolVersion
        : BEACON_PROTOCOL_VERSION,
    updatedAt: candidate.updatedAt,
    pid: typeof candidate.pid === "number" ? candidate.pid : undefined,
  };
}

async function getSiblingBeaconApi(): Promise<
  Partial<AgentNinjaExtensionApi> | undefined
> {
  const sibling =
    vscode.extensions.getExtension<AgentNinjaExtensionApi>(
      SIBLING_EXTENSION_ID,
    );
  if (!sibling) {
    return undefined;
  }
  try {
    // `activate()` returns the cached exports if already activated, so this
    // is safe to call repeatedly. It also waits if the sibling is mid-
    // activation, which solves the activation race window.
    const exports = (await sibling.activate()) as
      | Partial<AgentNinjaExtensionApi>
      | undefined;
    return exports || undefined;
  } catch (err) {
    console.warn(
      "[Skill Ninja] Failed to activate sibling extension for beacon read:",
      err,
    );
    return undefined;
  }
}

/**
 * Read the sibling's beacon via its exports API. Returns undefined if the
 * sibling is not installed, fails to activate, lacks the API, or returns an
 * invalid/expired beacon.
 */
export async function readSiblingBeacon(
  _context: vscode.ExtensionContext,
  nowMs: number = Date.now(),
): Promise<AgentNinjaBeacon | undefined> {
  const api = await getSiblingBeaconApi();
  const raw = api?.getAgentNinjaBeacon?.();
  return normalizeBeacon(raw, nowMs);
}

/**
 * True iff the sibling is BOTH installed (per VS Code extensions API) AND
 * exposes a valid beacon via its exports API. Both conditions are required
 * to avoid false positives when the sibling is uninstalled but the
 * `getExtension` cache hasn't refreshed yet.
 */
export async function isSiblingActive(
  context: vscode.ExtensionContext,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const installed = vscode.extensions.getExtension(SIBLING_EXTENSION_ID);
  if (!installed) {
    return false;
  }
  const beacon = await readSiblingBeacon(context, nowMs);
  return beacon !== undefined;
}

/**
 * Owner-decision algorithm. MUST be byte-identical between Skill NINJA and
 * Resource NINJA. Pure function for testability.
 *
 * Rules (in order):
 *   1. No sibling beacon -> self.
 *   2. self.kinds is a strict subset of sibling.kinds -> sibling.
 *   3. sibling.kinds is a strict subset of self.kinds -> self.
 *   4. Otherwise tie-break by lexicographic extensionId order.
 */
export function computeOwnership(
  self: { extensionId: string; kinds: ReadonlyArray<ResourceKind> },
  sibling:
    | { extensionId: string; kinds: ReadonlyArray<ResourceKind> }
    | undefined,
): OwnershipDecision {
  if (!sibling) {
    return {
      owner: "self",
      reason: "no-sibling",
      selfKinds: [...self.kinds],
      siblingInstalled: false,
    };
  }

  const selfSet = new Set(self.kinds);
  const siblingSet = new Set(sibling.kinds);

  const selfIsSubsetOfSibling =
    [...selfSet].every((k) => siblingSet.has(k)) &&
    selfSet.size < siblingSet.size;
  const siblingIsSubsetOfSelf =
    [...siblingSet].every((k) => selfSet.has(k)) &&
    siblingSet.size < selfSet.size;

  if (selfIsSubsetOfSibling) {
    return {
      owner: "sibling",
      reason: "sibling-superset",
      selfKinds: [...self.kinds],
      siblingKinds: [...sibling.kinds],
      siblingInstalled: true,
    };
  }
  if (siblingIsSubsetOfSelf) {
    return {
      owner: "self",
      reason: "self-superset",
      selfKinds: [...self.kinds],
      siblingKinds: [...sibling.kinds],
      siblingInstalled: true,
    };
  }

  // Equal sets, or disjoint/overlapping sets: deterministic tie-break.
  const owner: Ownership =
    self.extensionId < sibling.extensionId ? "self" : "sibling";
  return {
    owner,
    reason: "tiebreak",
    selfKinds: [...self.kinds],
    siblingKinds: [...sibling.kinds],
    siblingInstalled: true,
  };
}

/**
 * Read the user-configured coexistence mode. Defaults to "auto".
 */
export function getCoexistenceMode(): CoexistenceMode {
  const config = vscode.workspace.getConfiguration("skillNinja");
  const raw = config.get<string>("coexistenceMode");
  return raw === "independent" ? "independent" : "auto";
}

/**
 * Compute the effective owner taking into account the current sibling state
 * AND the coexistence mode. In "independent" mode the result is always
 * "self" (regardless of sibling), preserving legacy behavior.
 *
 * Async because reading the sibling beacon goes through the sibling's
 * `activate()` exports.
 */
export async function getEffectiveOwnership(
  context: vscode.ExtensionContext,
  nowMs: number = Date.now(),
): Promise<OwnershipDecision> {
  const mode = getCoexistenceMode();
  if (mode === "independent") {
    return {
      owner: "self",
      reason: "independent",
      selfKinds: [...SELF_KINDS],
      siblingInstalled:
        vscode.extensions.getExtension(SIBLING_EXTENSION_ID) !== undefined,
    };
  }

  const siblingInstalled = vscode.extensions.getExtension(SIBLING_EXTENSION_ID);
  const beacon = await readSiblingBeacon(context, nowMs);

  // Sibling extension is present but no valid beacon (older version or
  // mid-activation hiccup): defer using the conservative fallback kinds so
  // we don't double-write during the activation race window.
  let siblingDescriptor:
    | { extensionId: string; kinds: ReadonlyArray<ResourceKind> }
    | undefined;
  if (beacon) {
    siblingDescriptor = {
      extensionId: beacon.extensionId,
      kinds: beacon.kinds,
    };
  } else if (siblingInstalled) {
    siblingDescriptor = {
      extensionId: SIBLING_EXTENSION_ID,
      kinds: SIBLING_KINDS_FALLBACK,
    };
  }

  const decision = computeOwnership(
    { extensionId: SELF_EXTENSION_ID, kinds: SELF_KINDS },
    siblingDescriptor,
  );

  return {
    ...decision,
    siblingBeacon: beacon,
    siblingInstalled: siblingInstalled !== undefined,
  };
}

/**
 * Subscribe to ownership-relevant changes and call back whenever a
 * recomputation is warranted. Triggers:
 *   - vscode.extensions.onDidChange (sibling install/uninstall/enable/disable)
 *   - skillNinja.coexistenceMode setting change
 * The callback is invoked asynchronously so subscribers can safely run async
 * work without blocking the event loop.
 */
export function subscribeOwnershipChanges(
  callback: () => void | Promise<void>,
): vscode.Disposable {
  const fire = () => {
    Promise.resolve()
      .then(() => callback())
      .catch((err) => {
        console.error("[Skill Ninja] Ownership callback failed:", err);
      });
  };

  const extDisposable = vscode.extensions.onDidChange(() => fire());
  const cfgDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("skillNinja.coexistenceMode")) {
      fire();
    }
  });

  return new vscode.Disposable(() => {
    extDisposable.dispose();
    cfgDisposable.dispose();
  });
}
