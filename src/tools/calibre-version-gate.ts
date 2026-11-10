// Version gate for calls that need a newer Calibre (#499, D-029): one line at the call site,
// run before the gated call spawns calibredb. An unknown version lets the call run; a raw
// calibredb failure then still maps to its own error code.

import type { LibraryWriter } from "../calibre/client.js";
import { isAtLeast } from "../domain/calibre-version.js";
import { toolError } from "./result.js";
import type { ToolResult } from "./types.js";

/**
 * The `calibre_too_old` refusal when the running Calibre is older than `min` (`"9.18"`), else
 * undefined. Usage: `const old = await calibreTooOld(deps.calibre, "9.18"); if (old) return old;`
 */
export async function calibreTooOld(
  calibre: Pick<LibraryWriter, "calibreVersion">,
  min: string,
): Promise<ToolResult | undefined> {
  const v = await calibre.calibreVersion();
  if (v === "unknown" || isAtLeast(v, min)) return undefined;
  return toolError("calibre_too_old", `This call requires Calibre ${min}+ (found ${v.text}).`);
}
