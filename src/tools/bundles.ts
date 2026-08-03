// Shared Bundle domain (D-019, #93): reading saved-search/virtual-library bundles, resolving
// a tool's `filter` param to a search expression, and applying `-`-named exclusion markers to
// discovery queries. calibre_manage_bundles owns the write side; every filter-taking tool
// resolves through here. Honesty contract: whatever this layer subtracts or scopes is reported
// in text content by the caller — never silent subtraction.

import type { ToolDeps } from "./types.js";

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
export async function loadBundles(deps: ToolDeps, library?: string): Promise<BundleEntry[]> {
  const libId = await deps.content.resolveLibraryId(library);
  const { stdout } = await deps.calibre.calibredb(["saved_searches", "list"], { library: libId });
  let vls: Record<string, string> = {};
  try {
    vls = await deps.content.virtualLibraries(library);
  } catch (err) {
    deps.log.warn("virtual-library listing failed", {
      msg: err instanceof Error ? err.message : String(err),
    });
  }
  return mergeBundles(parseSavedSearches(stdout), vls);
}

// Bundle listing spawns calibredb (~hundreds of ms), so discovery calls read through a short
// TTL cache; manage_bundles writes invalidate it. Process-lifetime, single stdio client.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; bundles: BundleEntry[] }>();

export function invalidateBundleCache(libId?: string): void {
  if (libId === undefined) cache.clear();
  else cache.delete(libId);
}

/** loadBundles through the TTL cache, keyed by resolved libId. */
export async function loadBundlesCached(
  deps: ToolDeps,
  library?: string,
): Promise<{ libId: string; bundles: BundleEntry[] }> {
  const libId = await deps.content.resolveLibraryId(library);
  const hit = cache.get(libId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { libId, bundles: hit.bundles };
  const bundles = await loadBundles(deps, library);
  cache.set(libId, { at: Date.now(), bundles });
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
}

export type FilterOutcome = { ok: true; res: FilterResolution } | { ok: false; error: string };

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
    bundles = (await loadBundlesCached(deps, req.library)).bundles;
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

/**
 * Resolve the allowed book-id set for paths that can't expand a server-side expression
 * (semantic index, FTS grouping): one /ajax/search call on the scope expression.
 * Query-time only — the semantic index never bakes bundles in (D-019).
 */
const RESTRICT_MAX = 100_000;

export async function restrictSet(
  deps: ToolDeps,
  res: FilterResolution,
  library?: string,
): Promise<Set<number> | undefined> {
  if (!isScoped(res)) return undefined;
  const page = await deps.content.search({
    query: scopeExpression(res),
    library,
    num: RESTRICT_MAX,
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
