// Gate-off wording for write steers (#519): with CALIBRE_MCP_ENABLE_WRITE off, a preview names
// what applying needs, never a call that returns write_disabled or a tool that is hidden then.

import { defaultHint } from "../domain/error-codes.js";

/** The remedy clause, worded as the bundles steer from #513. */
export const NEEDS_WRITES = "needs writes enabled (CALIBRE_MCP_ENABLE_WRITE)";

/**
 * The closing steer of a write tool's preview.
 * @param writeEnabled the master write gate (`deps.config.writeEnabled`)
 * @param gateOn the tool's own steer, returned unchanged when the gate is on
 * @param subject what applying would do, e.g. "Removing them" → "Removing them needs writes enabled (…)."
 */
export function writeStep(writeEnabled: boolean, gateOn: string, subject: string): string {
  return writeEnabled ? gateOn : `${subject} ${NEEDS_WRITES}.`;
}

/** The `detail` of an FTS outcome refused by the write gate: the gate hint plus the GUI route (#447). */
export const FTS_WRITE_DISABLED_DETAIL = `${defaultHint("write_disabled") ?? ""}; or enable FTS in the Calibre GUI (the FT button left of the search bar)`;

/** The end of an unknown-bundle error: what the session can do about it, by write gate (#435). */
export function unknownBundleSteer(writeEnabled: boolean): string {
  return writeEnabled
    ? `Create one with calibre_manage_bundles { action: "create" }.`
    : `List them with calibre_manage_bundles { action: "list" }; creating one ${NEEDS_WRITES}.`;
}

/** The error text of a failed filter resolution; an unknown bundle gets the steer for the current write gate. */
export function filterErrorText(fr: { error: string; unknownBundle?: true }, writeEnabled: boolean): string {
  return fr.unknownBundle ? `${fr.error} ${unknownBundleSteer(writeEnabled)}` : fr.error;
}
