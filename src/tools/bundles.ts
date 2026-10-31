// Shared Bundle domain (D-019, #93): reading saved-search/virtual-library bundles, resolving
// a tool's `filter` param to a search expression, and applying `-`-named exclusion markers to
// discovery queries. calibre_manage_bundles owns the write side; every filter-taking tool
// resolves through here. Honesty contract: whatever this layer subtracts or scopes is reported
// in text content by the caller — never silent subtraction.

import type { LibId } from "../calibre/lib-id.js";
import type { ToolDeps } from "./deps.js";

export interface BundleEntry {
  name: string;
  expression: string;
  kind: "saved_search" | "virtual_library";
  /** Virtual libraries can be read and used as filters, but not written from here. */
  read_only: boolean;
  /** A leading `-` marks a bundle whose books discovery searches subtract by default. */
  is_exclusion_marker: boolean;
}

/**
 * Parse `calibredb saved_searches list` stdout. The CLI prints one `Name:` / `Search string:`
 * pair per search, and prepends unrelated noise ("Integration status: False") that must be
 * tolerated rather than parsed. A pair is only emitted once its search string arrives.
 */
export function parseSavedSearches(stdout: string): Array<{ name: string; expression: string }> {
  const out: Array<{ name: string; expression: string }> = [];
  let pending: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const name = /^Name:\s*(.*)$/.exec(line);
    if (name) {
      pending = (name[1] ?? "").trim();
      continue;
    }
    const expr = /^Search string:\s*(.*)$/.exec(line);
    if (expr && pending !== undefined) {
      out.push({ name: pending, expression: (expr[1] ?? "").trim() });
      pending = undefined;
    }
  }
  return out;
}

/** True when a bundle name starts with `-` — an exclusion marker subtracted from default scope (D-019). */
export function isExclusionMarker(name: string): boolean {
  return name.startsWith("-");
}

/** Merge saved searches (writable) with virtual libraries (read-only) into one bundle list. */
export function mergeBundles(
  savedSearches: Array<{ name: string; expression: string }>,
  virtualLibraries: Record<string, string>,
): BundleEntry[] {
  const entries: BundleEntry[] = savedSearches.map((s) => ({
    name: s.name,
    expression: s.expression,
    kind: "saved_search",
    read_only: false,
    is_exclusion_marker: isExclusionMarker(s.name),
  }));
  for (const [name, expression] of Object.entries(virtualLibraries)) {
    entries.push({
      name,
      expression,
      kind: "virtual_library",
      read_only: true,
      is_exclusion_marker: isExclusionMarker(name),
    });
  }
  return entries;
}

/** Read every bundle. VLs are a nicety — a failing /interface-data must not kill the read. */
export async function loadBundles(
  deps: ToolDeps,
  library?: string,
  opts: { timeoutMs?: number } = {},
): Promise<BundleEntry[]> {
  const libId = await deps.content.resolveLibraryId(library);
  const { stdout } = await deps.calibre.calibredb(["saved_searches", "list"], {
    library: libId,
    timeoutMs: opts.timeoutMs,
  });
  let vls: Record<string, string> = {};
  try {
    vls = await deps.content.virtualLibraries(library, { timeoutMs: opts.timeoutMs });
  } catch (err) {
    deps.log.warn("virtual-library listing failed", {
      msg: err instanceof Error ? err.message : String(err),
    });
  }
  return mergeBundles(parseSavedSearches(stdout), vls);
}

// Bundle listing spawns calibredb and, like every Calibre read, queues behind a running FTS
// search (it was the first 30 s of the 90 s hang). So discovery calls read stale-while-
// revalidate: a cached list answers at once and refreshes in the background; only a cold cache
// waits, briefly. manage_bundles writes invalidate. Process-lifetime, single stdio client.
const CACHE_FRESH_MS = 30_000;
/** Cold-cache wait for the best-effort exclusion sweep. Basis: `saved_searches list` answers in 0.5–1.4 s (2026-10-31). */
export const BUNDLES_COLD_TIMEOUT_MS = 5_000;
/** Background refreshes don't block anyone, but must still end. */
const BACKGROUND_TIMEOUT_MS = 15_000;
const cache = new Map<LibId, { at: number; bundles: BundleEntry[] }>();
const inflight = new Map<LibId, Promise<BundleEntry[]>>();
// Bumped by every invalidation: a refresh started before a write must not re-store pre-write data.
let generation = 0;

/** Drop cached bundle listings for one libId, or all libraries when omitted (called after bundle writes). */
export function invalidateBundleCache(libId?: LibId): void {
  generation++;
  if (libId === undefined) {
    cache.clear();
    inflight.clear();
  } else {
    cache.delete(libId);
    inflight.delete(libId);
  }
}

// Single-flight load per library; stores only if no invalidation happened meanwhile.
function refreshBundles(deps: ToolDeps, libId: LibId, library: string | undefined, timeoutMs: number) {
  const running = inflight.get(libId);
  if (running) return running;
  const gen = generation;
  const p = loadBundles(deps, library, { timeoutMs })
    .then((bundles) => {
      if (gen === generation) cache.set(libId, { at: Date.now(), bundles });
      return bundles;
    })
    .finally(() => {
      if (inflight.get(libId) === p) inflight.delete(libId);
    });
  inflight.set(libId, p);
  return p;
}

/**
 * loadBundles through the stale-while-revalidate cache, keyed by resolved libId. A stale hit
 * returns immediately and refreshes in the background; a cold miss waits at most `timeoutMs`.
 */
export async function loadBundlesCached(
  deps: ToolDeps,
  library?: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ libId: LibId; bundles: BundleEntry[] }> {
  const libId = await deps.content.resolveLibraryId(library);
  const hit = cache.get(libId);
  if (hit) {
    if (Date.now() - hit.at >= CACHE_FRESH_MS) {
      void refreshBundles(deps, libId, library, BACKGROUND_TIMEOUT_MS).catch((err: unknown) =>
        deps.log.warn("background bundle refresh failed", { msg: err instanceof Error ? err.message : String(err) }),
      );
    }
    return { libId, bundles: hit.bundles };
  }
  const bundles = await refreshBundles(deps, libId, library, opts.timeoutMs ?? BUNDLES_COLD_TIMEOUT_MS);
  return { libId, bundles };
}

/** What the filter layer resolved for one discovery call — input to query building + honesty. */
export interface FilterResolution {
  /** The resolved `filter` bundle, when one was requested. */
  bundle?: BundleEntry;
  /** Exclusion markers being subtracted from this call (empty = nothing subtracted). */
  markers: BundleEntry[];
  /** Same-name saved search shadowed a virtual library — noted per D-019 collision rule. */
  collisionNote?: string;
  /** Markers skipped or unavailable — reported, never silent (honesty contract). */
  degradeNote?: string;
}

export interface FilterRequest {
  /** Bundle name to scope the call to; a `-` name targets that marker directly. */
  filter?: string;
  /** Opt out of automatic marker subtraction (discovery tools only). */
  includeExcluded?: boolean;
  /** Whether this tool auto-subtracts exclusion markers (the discovery trio). */
  autoExclude: boolean;
  library?: string;
  /**
   * What is left of the caller's per-call deadline. A load-bearing `filter` may use all of it;
   * the best-effort exclusion sweep waits at most {@link BUNDLES_COLD_TIMEOUT_MS}.
   */
  timeoutMs?: number;
}

export type FilterOutcome = { ok: true; res: FilterResolution } | { ok: false; error: string };

// A load-bearing `filter` may wait out the caller's whole budget; the best-effort exclusion
// sweep waits at most the short cold cap so a stalled Calibre can't hold the search hostage.
function coldWait(req: FilterRequest): number | undefined {
  if (req.filter) return req.timeoutMs;
  return Math.min(BUNDLES_COLD_TIMEOUT_MS, req.timeoutMs ?? BUNDLES_COLD_TIMEOUT_MS);
}

/**
 * Resolve a call's filter/exclusion inputs against the library's bundles.
 * - No filter and no auto-exclusion (or opted out) → no bundle read at all (zero cost).
 * - Unknown filter name → error listing available bundles (the agent's discovery affordance).
 * - `filter` naming a marker targets it and disables auto-exclusion (else always-empty result).
 * - Auto-exclusion failing to load bundles degrades with a note; a failing `filter` load errors
 *   (the filter is load-bearing, the exclusion sweep is not).
 */
export async function resolveFilter(deps: ToolDeps, req: FilterRequest): Promise<FilterOutcome> {
  const wantExclusions = req.autoExclude && req.includeExcluded !== true;
  if (!req.filter && !wantExclusions) return { ok: true, res: { markers: [] } };
  // No calibredb wired (fixture/eval deps, degraded deployments) = bundles unsupported:
  // the auto-exclusion sweep is off, not failing — nothing to report. An explicit filter
  // still falls through and errors, since the caller asked for something we can't resolve.
  const canList = typeof (deps.calibre as { calibredb?: unknown } | undefined)?.calibredb === "function";
  if (!req.filter && !canList) return { ok: true, res: { markers: [] } };

  let bundles: BundleEntry[];
  try {
    bundles = (await loadBundlesCached(deps, req.library, { timeoutMs: coldWait(req) })).bundles;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (req.filter) {
      return { ok: false, error: `Cannot resolve filter "${req.filter}" — bundle listing failed: ${msg}` };
    }
    // Exclusion sweep is best-effort: degrade honestly rather than fail the search.
    return { ok: true, res: { markers: [], degradeNote: `exclusion check unavailable (${msg})` } };
  }

  const res: FilterResolution = { markers: [] };

  if (req.filter) {
    // Saved search wins a name collision with a VL (D-019); say so rather than pick silently.
    const matches = bundles.filter((b) => b.name === req.filter);
    const bundle = matches.find((b) => b.kind === "saved_search") ?? matches[0];
    if (!bundle) {
      const names = bundles.map((b) => b.name);
      return {
        ok: false,
        error:
          `Unknown bundle "${req.filter}". Available bundles: ${names.join(", ") || "(none)"}. ` +
          `Create one with calibre_manage_bundles { action: "create" }.`,
      };
    }
    if (matches.length > 1) {
      res.collisionNote = `"${bundle.name}" names both a saved search and a virtual library — using the saved search.`;
    }
    res.bundle = bundle;
  }

  // A marker used AS the filter targets those books — subtracting them too would empty it.
  if (wantExclusions && !res.bundle?.is_exclusion_marker) {
    const skipped: string[] = [];
    for (const b of bundles) {
      if (!b.is_exclusion_marker || b.kind !== "saved_search") continue;
      if (b.name === res.bundle?.name) continue;
      // `search:"=name"` has no escape for quotes — skip such markers loudly, never silently.
      if (b.name.includes('"')) skipped.push(b.name);
      else res.markers.push(b);
    }
    if (skipped.length > 0) {
      res.degradeNote = `marker(s) not subtracted (name contains a quote): ${skipped.join(", ")}`;
    }
  }

  return { ok: true, res };
}

/**
 * Compose the effective Calibre search expression for a resolved filter:
 * `(<query>) and (<bundle expression>) and not search:"=-marker" …`. Marker subtraction
 * references the saved search BY NAME (server-side resolution) — the bundle filter inlines
 * its expression so virtual-library bundles work too (`search:` can't reference a VL).
 */
export function buildScopedQuery(base: string, res: FilterResolution): string {
  const trimmed = base.trim();
  // Unscoped call → the query byte-identical to the pre-filter era (stable cursor keys).
  if (!isScoped(res)) return trimmed;
  const parts: string[] = [];
  if (trimmed.length > 0) parts.push(`(${trimmed})`);
  if (res.bundle) parts.push(`(${res.bundle.expression})`);
  for (const m of res.markers) parts.push(`not search:"=${m.name}"`);
  return parts.join(" and ");
}

/** The scope expression alone (filter + subtraction, no user query) — for counts/id sets. */
export function scopeExpression(res: FilterResolution): string {
  return buildScopedQuery("", res);
}

/** True when this resolution changes what a query would return (needs honesty + restriction). */
export function isScoped(res: FilterResolution): boolean {
  return res.bundle !== undefined || res.markers.length > 0;
}

// Upper bound on ids fetched for a scope restriction — larger than any real library.
const RESTRICT_MAX = 100_000;

/**
 * Resolve the allowed book-id set for paths that can't expand a server-side expression
 * (semantic index, FTS grouping): one /ajax/search call on the scope expression.
 * Query-time only — the semantic index never bakes bundles in (D-019).
 * Returns undefined when the resolution is unscoped (no restriction needed).
 */
export async function restrictSet(
  deps: ToolDeps,
  res: FilterResolution,
  library?: string,
  timeoutMs?: number,
): Promise<Set<number> | undefined> {
  if (!isScoped(res)) return undefined;
  const page = await deps.content.search({
    query: scopeExpression(res),
    library,
    num: RESTRICT_MAX,
    timeoutMs,
  });
  return new Set(page.bookIds);
}

/**
 * The honesty lines every scoped response must carry in TEXT content (clients strip
 * structuredContent): what was scoped, what was subtracted, how to opt out.
 */
export function honestyLines(res: FilterResolution, bundleBooks?: number): string[] {
  const lines: string[] = [];
  if (res.bundle) {
    const n = bundleBooks !== undefined ? ` (${bundleBooks} books)` : "";
    lines.push(`filter: ${res.bundle.name}${n}`);
  }
  if (res.markers.length > 0) {
    lines.push(
      `exclusions applied: [${res.markers.map((m) => m.name).join(", ")}] (pass include_excluded=true to disable)`,
    );
  }
  if (res.collisionNote) lines.push(res.collisionNote);
  if (res.degradeNote) lines.push(res.degradeNote);
  return lines;
}
