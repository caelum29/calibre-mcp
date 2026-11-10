// Gate-off wording for write steers (#519): with CALIBRE_MCP_ENABLE_WRITE off, a preview names
// what applying needs, never a call that returns write_disabled or a tool that is hidden then.

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
