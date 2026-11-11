// Reading `calibredb add` output when it reports no new ids (#555). calibredb skips a file
// whose title+author already exist and says so in a report (contract read from calibre 9.x
// cmd_add); any other no-ids output is a failure we classify but never quote to the model.

/**
 * Titles calibredb reports as skipped duplicates. Its report goes to stderr: a header that
 * names the `--duplicates` option (the header text itself is localized), then one indented
 * title per skipped book; the file paths go to stdout.
 */
export function parseSkippedTitles(output: string): string[] {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes("--duplicates"));
  if (start < 0) return [];
  const titles: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(l)) break;
    titles.push(l.trim());
  }
  return titles;
}

/** Known shapes of a no-ids failure; `other` is everything we can't name. */
export type AddFailureCause = "unsupported_format" | "permission_denied" | "other";

/** Why an add came back with no new ids. `stderr` (failures only) is for the log, never the model. */
export type NoIdsOutcome =
  | { kind: "duplicate"; title?: string }
  | { kind: "failed"; cause: AddFailureCause; stderr: string };

/**
 * Classify a no-new-ids add. A parsed duplicate report (stderr, or stdout) → duplicate. Empty
 * stderr → duplicate too: the report format comes from Calibre's code, not a live capture, so
 * an unparsed real skip must keep its label. Any other stderr is a failure.
 */
export function classifyNoIds(stdout: string, stderr: string): NoIdsOutcome {
  for (const stream of [stderr, stdout]) {
    if (stream.split(/\r?\n/).some((l) => l.includes("--duplicates"))) {
      return { kind: "duplicate", title: parseSkippedTitles(stream)[0] };
    }
  }
  const trimmed = stderr.trim();
  if (trimmed === "") return { kind: "duplicate" };
  return { kind: "failed", cause: failureCause(trimmed), stderr: trimmed };
}

function failureCause(stderr: string): AddFailureCause {
  if (/unsupported (file )?format|not a supported|unknown (file )?format/i.test(stderr)) return "unsupported_format";
  if (/PermissionError|permission denied|Errno 13|EACCES/i.test(stderr)) return "permission_denied";
  return "other";
}
