// Calibre's own write gate, as seen by a zero-side-effect probe (#439). The Content Server checks
// write access before it checks the module version, so a POST to a write module at a version that
// cannot exist answers 403 when writes are refused and 404 "not available in version" when allowed.
// Read from Calibre's source for the contract only (D-004); version-fragile, hence `unknown`.

/** Whether the Content Server accepts writes from us. */
type CalibreWriteAccess = "allowed" | "refused" | "unknown";

/** The probe's verdict; `reason` says why it could not tell. */
export type WriteAccessProbe =
  | { access: Exclude<CalibreWriteAccess, "unknown"> }
  | { access: "unknown"; reason: string };

// the 404 for a missing module version; any other 404 (wrong path, old server) proves nothing
const UNKNOWN_VERSION_BODY = /not available in version/i;

/** Map the probe's HTTP answer onto a verdict; anything unexpected is `unknown`, never a guess. */
export function classifyWriteProbe(status: number, body: string): WriteAccessProbe {
  if (status === 403) return { access: "refused" };
  if (status === 404 && UNKNOWN_VERSION_BODY.test(body)) return { access: "allowed" };
  return { access: "unknown", reason: `HTTP ${status}` };
}
