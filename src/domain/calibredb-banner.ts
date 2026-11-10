// The "Integration status: False" banner calibredb prints before its real stdout (#518): one
// place to drop it, so every stdout parser agrees on what "noise first" means. Pure, no I/O.

/** True for a banner line; line-oriented status parsers drop these at any position. */
export function isCalibredbBannerLine(line: string): boolean {
  return line.startsWith("Integration status:");
}

/** calibredb stdout without its leading `Integration status: …` banner lines; the rest is untouched. */
export function stripCalibredbBanner(stdout: string): string {
  // leading only: a banner-looking line inside a note or a result is content, not noise
  return stdout.replace(/^(?:Integration status: .*\n)+/, "");
}
