// calibre_merge_books (spec #50) — DESTRUCTIVE gated write. Mirrors Calibre's GUI merge
// (M / Alt+M / Shift+M): move formats into an explicit target, merge metadata per
// Calibre's rules, trash the sources. Dry-run unless confirm=true; execution is a step
// ledger with delete ALWAYS last, so any abort leaves a superset state (issue #33).

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { buildSetMetadataArgs } from "../calibre/metadata-fields.js";
import type { ChangeValue } from "../domain/book-fields.js";
import { downloadToFile } from "../calibre/http.js";
import type { Book } from "../domain/book.js";
import { isSimilarMatch } from "../domain/curation/normalize.js";
import { CalibreCliError } from "../domain/errors.js";
import { mergeBuiltinMetadata, mergeCustomMetadata, planFormatMoves } from "../domain/merge.js";
import type { FormatMove } from "../domain/merge.js";
import { CoercedBool, CoercedInt, jsonArray } from "./coerce.js";
import { defineTool } from "./define.js";
import { fence, toolError, toolOk, toolErrorFrom, errorFromCatch } from "./result.js";
import type { BaseDeps } from "./deps.js";
import {
  settleFailedStep,
  settleFailedWrite,
  isLanded,
  isUnverified,
  type ReReadCause,
  type UnconfirmedCheck,
} from "../app/write-policy.js";
import { presentFailedWrite, type FailedWrite } from "./write-failure.js";
import { formatOnTarget, sourcesRemoved } from "../app/merge-verify.js";

/** One executed (or planned) write step in the merge ledger. */
interface Step {
  step: string;
  status: "pending" | "done" | "skipped" | "failed" | "not-run";
  note?: string;
  /** What a failed step threw — the "did not start" result's errorCode (#249). Not rendered. */
  cause?: unknown;
  /** The step may have committed: a re-read could not confirm it (#413). Not rendered. */
  unverified?: boolean;
  /** The next step the note already spells out, so the error adds no generic `Next:` line. Not rendered. */
  hint?: string;
  /** The note carries its own re-run instruction, so the ledger adds none (#413). Not rendered. */
  ownRerun?: boolean;
}

/** The benign `--dont-replace` collision: target already holds that format (probe §1). */
function isFormatCollision(err: unknown): boolean {
  return err instanceof CalibreCliError && /already exists for book/i.test(err.stderr ?? "");
}

const CAUSE_TEXT: Record<ReReadCause, string> = {
  timeout: "calibredb timed out",
  dropped: "the connection dropped mid-request",
};

// The steer for a write that may have committed but a re-read could not confirm (#33, #413).
function unconfirmedNote(cause: ReReadCause, what: string, verify: string): string {
  return `${CAUSE_TEXT[cause]} and the re-read does not confirm ${what} — verify with ${verify} before retrying`;
}

/** Mark `step` failed from a settled outcome; an unverified one gets the caller's re-read steer. */
function failStep<T>(
  step: Step,
  outcome: FailedWrite<T>,
  err: unknown,
  targetId: number,
  unverifiedNote: (cause: ReReadCause, check: UnconfirmedCheck<T>) => string,
): void {
  step.status = "failed";
  step.cause = err;
  step.unverified = isUnverified(outcome);
  // the shared presenter words every other kind (refusal, transient, unexpected) with its next step (#417)
  // merge never retries (its calls aren't wrapped in withTransientRetry), so say 0, not the default
  const shown = presentFailedWrite(outcome, { id: targetId, err, retries: 0, unconfirmed: unverifiedNote });
  step.note = shown.text;
  step.hint = shown.hint;
}

const STATUS_MARK: Record<Step["status"], string> = {
  pending: "•",
  done: "✓",
  skipped: "~",
  failed: "✗",
  "not-run": "-",
};

export const mergeBooksTool = defineTool({
  name: "calibre_merge_books",
  title: "Merge duplicate books",
  description:
    "Merge duplicate book records: moves formats from the `sourceIds` books into `targetId` (the target's copy " +
    "wins conflicts), merges metadata per Calibre's rules, then trashes the sources. mode=safe " +
    "keeps sources; mode=formatsOnly moves formats only. Dry-run unless confirm=true. Requires " +
    "writes to be enabled.",
  inputSchema: {
    targetId: CoercedInt(),
    sourceIds: jsonArray(CoercedInt()),
    mode: z.enum(["merge", "safe", "formatsOnly"]).default("merge"),
    confirm: CoercedBool().default(false),
    library: z.string().optional(),
  },
  outputSchema: {
    status: z.enum(["planned", "merged", "incomplete"]).optional(),
    targetId: z.number().optional(),
    sourceIds: z.array(z.number()).optional(),
    mode: z.string().optional(),
    warnings: z.array(z.string()).optional(),
    formatMoves: z.array(z.object({ format: z.string(), sourceId: z.number(), action: z.string() })).optional(),
    metadataChanges: z.record(z.string(), z.unknown()).optional(),
    steps: z.array(z.object({ step: z.string(), status: z.string(), note: z.string().optional() })).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  write: true,
  handler: async (args, deps) => {
    try {
      const sourceIds = [...new Set(args.sourceIds)];
      if (sourceIds.length === 0) {
        return toolError("invalid_input", "Provide at least one source book id in sourceIds.");
      }
      if (sourceIds.includes(args.targetId)) {
        return toolError("invalid_input", "sourceIds must not include targetId — the target is the surviving record.");
      }

      // Fresh reads every call: the confirm run re-verifies the sources still exist.
      const allIds = [args.targetId, ...sourceIds];
      const map = await deps.content.booksByIds(allIds, args.library);
      const missing = allIds.filter((id) => !map.get(id));
      if (missing.length > 0) {
        return toolError(
          "not_found",
          `No book(s) with id ${missing.join(", ")} — check with calibre_get_book ` +
            `(they may already have been merged or removed).`,
        );
      }
      const target = map.get(args.targetId)!;
      const sources = sourceIds.map((id) => map.get(id)!);
      const formatsOnly = args.mode === "formatsOnly";

      const formatMoves = planFormatMoves(target, sources);

      // Metadata plan (merge/safe): built-ins from the domain Books, custom columns +
      // cover presence from the raw /ajax facts. Unions are computed HERE — routed
      // set_metadata replaces multi-value fields wholesale (probe §2).
      let metadataChanges: Record<string, ChangeValue> = {};
      let coverFrom: number | undefined;
      if (!formatsOnly) {
        const facts = await Promise.all(allIds.map((id) => deps.content.bookMergeFacts(id, args.library)));
        const targetFacts = facts[0]!;
        const sourceFacts = facts.slice(1);
        metadataChanges = {
          ...mergeBuiltinMetadata(target, sources),
          ...mergeCustomMetadata(
            targetFacts.customFields,
            sourceFacts.map((f) => f.customFields),
          ),
        };
        if (!targetFacts.hasCover) {
          const i = sourceFacts.findIndex((f) => f.hasCover);
          if (i >= 0) coverFrom = sourceIds[i];
        }
      }

      // Advisory only — merge never refuses on dissimilarity (#38 Q5).
      const warnings: string[] = [];
      for (const s of sources) {
        // Different key, different edition/volume, or a title with no letters (#241, #242).
        if (!isSimilarMatch(target, s)) {
          warnings.push(
            `Source #${s.id} "${s.title}" does not look like the same work as the target ` +
              `(title, author or edition mismatch). Advisory only — confirm proceeds regardless.`,
          );
        }
      }

      if (!args.confirm) {
        return planResult(target, sources, args.mode, formatMoves, metadataChanges, coverFrom, warnings);
      }

      return await executeMerge(deps, {
        target,
        sources,
        sourceIds,
        mode: args.mode,
        library: args.library,
        formatMoves,
        metadataChanges,
        coverFrom,
        warnings,
      });
    } catch (err) {
      return errorFromCatch(err);
    }
  },
});

/** Render the dry-run plan (this IS the preview — no plan token; confirm recomputes). */
function planResult(
  target: Book,
  sources: Book[],
  mode: string,
  formatMoves: FormatMove[],
  metadataChanges: Record<string, ChangeValue>,
  coverFrom: number | undefined,
  warnings: string[],
) {
  const lines: string[] = [];
  lines.push(`Survivor: #${target.id} ${target.title} — ${target.authors.join(", ")}`);
  for (const w of warnings) lines.push(`⚠ ${w}`);

  lines.push("Formats:");
  if (formatMoves.length === 0) lines.push("  (sources have no formats)");
  for (const m of formatMoves) {
    lines.push(
      m.action === "moves"
        ? `  #${m.sourceId} ${m.format} → moves to #${target.id}`
        : `  #${m.sourceId} ${m.format} → DROPPED — target's copy wins`,
    );
  }

  if (mode !== "formatsOnly") {
    const entries = Object.entries(metadataChanges);
    lines.push(`Metadata changes on #${target.id}:`);
    if (entries.length === 0 && coverFrom === undefined) lines.push("  (none)");
    for (const [field, value] of entries) lines.push(`  ${field} → ${JSON.stringify(value)}`);
    if (coverFrom !== undefined) lines.push(`  cover → filled from #${coverFrom}`);
  } else {
    lines.push("Metadata: untouched (mode=formatsOnly)");
  }

  lines.push(
    mode === "safe"
      ? `Sources kept (mode=safe): ${sources.map((s) => `#${s.id}`).join(", ")}`
      : `Sources trashed (recoverable from Calibre's trash): ${sources.map((s) => `#${s.id}`).join(", ")}`,
  );

  const text =
    `Dry run — nothing written. Re-run with confirm=true to execute.\n` + fence("MERGE PLAN", lines.join("\n"));
  return toolOk([{ type: "text", text }], {
    status: "planned",
    targetId: target.id,
    sourceIds: sources.map((s) => s.id),
    mode,
    warnings,
    formatMoves,
    metadataChanges,
  });
}

interface MergeJob {
  target: Book;
  sources: Book[];
  sourceIds: number[];
  mode: "merge" | "safe" | "formatsOnly";
  library?: string;
  formatMoves: FormatMove[];
  metadataChanges: Record<string, ChangeValue>;
  coverFrom?: number;
  warnings: string[];
}

/**
 * Execute the confirmed merge as a step ledger: add formats → merge metadata → trash
 * sources, delete ALWAYS last. Any failure aborts the remaining steps; because nothing
 * is deleted until every prior step verified, an abort never loses data (issue #33).
 */
async function executeMerge(deps: BaseDeps, job: MergeJob) {
  const { target, sourceIds, mode } = job;
  const libId = await deps.content.resolveLibraryId(job.library);
  const base = deps.config.serverUrl.replace(/\/+$/, "");

  const moves = job.formatMoves.filter((m) => m.action === "moves");
  const moveSteps = moves.map<Step>((m) => ({
    step: `move ${m.format} from #${m.sourceId} to #${target.id}`,
    status: "pending",
  }));
  const hasMetadata =
    mode !== "formatsOnly" && (Object.keys(job.metadataChanges).length > 0 || job.coverFrom !== undefined);
  const metaStep: Step | undefined = hasMetadata
    ? { step: `merge metadata into #${target.id}`, status: "pending" }
    : undefined;
  const removeStep: Step | undefined =
    mode !== "safe"
      ? { step: `trash sources ${sourceIds.map((id) => `#${id}`).join(", ")}`, status: "pending" }
      : undefined;
  const steps: Step[] = [...moveSteps, ...(metaStep ? [metaStep] : []), ...(removeStep ? [removeStep] : [])];

  let aborted = false;
  let tmpDir: string | undefined;
  const tmp = async () => (tmpDir ??= await mkdtemp(join(tmpdir(), "calibre-mcp-merge-")));

  try {
    // Phase 1 — move formats (download from /get, upload via routed add_format).
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i]!;
      const step = moveSteps[i]!;
      try {
        const file = join(await tmp(), `${m.sourceId}.${m.format}`);
        await downloadToFile(`${base}/get/${m.format.toUpperCase()}/${m.sourceId}/${encodeURIComponent(libId)}`, file);
        await deps.calibre.calibredb(["add_format", "--dont-replace", String(target.id), file], { library: libId });
        step.status = "done";
      } catch (err) {
        if (isFormatCollision(err)) {
          step.status = "skipped";
          step.note = "target already has this format";
          continue;
        }
        // A routed write commits server-side before calibredb replies: a timeout or a drop is
        // settled by a re-read of the target's formats (#33, #413).
        const outcome = await settleFailedStep(err, () => formatOnTarget(deps, target.id, m.format, job.library));
        if (isLanded(outcome)) {
          step.status = "done";
          continue;
        }
        failStep(step, outcome, err, target.id, (cause) =>
          unconfirmedNote(cause, `${m.format} on #${target.id}`, `calibre_get_book id=${target.id}`),
        );
        aborted = true;
        break;
      }
    }

    // Post-phase verify: every moved format must be on the target before anything is
    // deleted. A failed VERIFY re-read never fails committed adds (issue #33) — it
    // degrades to a note; only a successful re-read that lacks a format aborts.
    if (!aborted && moveSteps.some((s) => s.status === "done")) {
      try {
        const after = await deps.content.getBook(target.id, job.library);
        for (let i = 0; i < moves.length; i++) {
          if (moveSteps[i]!.status === "done" && !after.formats.includes(moves[i]!.format)) {
            moveSteps[i]!.status = "failed";
            moveSteps[i]!.note = "format not present on target after add";
            aborted = true;
          }
        }
      } catch {
        for (const s of moveSteps) {
          if (s.status === "done") s.note = "verification re-read failed; add was reported committed";
        }
      }
    }

    // Phase 2 — one routed set_metadata with the full merged field set.
    if (!aborted && metaStep) {
      try {
        const changes: Record<string, ChangeValue> = { ...job.metadataChanges };
        if (job.coverFrom !== undefined) {
          const coverPath = join(await tmp(), `cover-${job.coverFrom}.jpg`);
          await downloadToFile(`${base}/get/cover/${job.coverFrom}/${encodeURIComponent(libId)}`, coverPath);
          changes.cover = coverPath;
        }
        await deps.calibre.calibredb(buildSetMetadataArgs(target.id, changes), {
          library: libId,
        });
        metaStep.status = "done";
      } catch (err) {
        // Verify on the built-in subset (custom #columns aren't carried on Book).
        const builtin = Object.fromEntries(Object.entries(job.metadataChanges).filter(([k]) => !k.startsWith("#")));
        const outcome = await settleFailedWrite(
          deps,
          { id: target.id, before: target, changes: builtin, library: job.library },
          err,
        );
        if (isLanded(outcome)) metaStep.status = "done";
        else {
          failStep(metaStep, outcome, err, target.id, (cause) =>
            unconfirmedNote(cause, "the metadata merge", `calibre_get_book id=${target.id}`),
          );
          aborted = true;
        }
      }
    }

    // Phase 3 — trash sources, ONLY after everything above verified. Never --permanent:
    // removed records land in Calibre's trash, recoverable for ~14 days (probe §5).
    if (!aborted && removeStep) {
      try {
        await deps.calibre.calibredb(["remove", sourceIds.join(",")], { library: libId });
        removeStep.status = "done";
      } catch (err) {
        // Removed books 404 immediately on /ajax (probe §4) — all gone = committed.
        let remaining: number[] = [...sourceIds];
        const outcome = await settleFailedStep(err, async () => {
          const r = await sourcesRemoved(deps, sourceIds, job.library);
          remaining = r.remaining;
          return r.check;
        });
        if (isLanded(outcome)) removeStep.status = "done";
        else {
          failStep(removeStep, outcome, err, target.id, (cause, check) => {
            // A re-run with an already-trashed source fails not_found, so name only what is left.
            const gone = sourceIds.filter((id) => !remaining.includes(id));
            const verify = `calibre_get_book id=${remaining.join(" / id=")}`;
            const rerun = `re-run with sourceIds=[${remaining.join(",")}] (formats and metadata are already on the target)`;
            return check.status === "not-landed"
              ? `${CAUSE_TEXT[cause]}; ${remaining.map((id) => `#${id}`).join(", ")} still exist` +
                  (gone.length > 0 ? ` (${gone.map((id) => `#${id}`).join(", ")} already in the trash)` : "") +
                  ` — verify with ${verify}, then ${rerun}`
              : `${unconfirmedNote(cause, "the removal", verify)}, then ${rerun}, leaving out any that 404`;
          });
          removeStep.ownRerun = removeStep.unverified;
        }
      }
    }
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  for (const s of steps) if (s.status === "pending") s.status = "not-run";
  return ledgerResult(job, steps);
}

/** Classify the ledger per issue #33: isError ONLY when nothing was committed. */
function ledgerResult(job: MergeJob, steps: Step[]) {
  const { target, sourceIds, mode } = job;
  const failed = steps.filter((s) => s.status === "failed");
  const committed = steps.some((s) => s.status === "done");
  const ledger = steps.map((s) => `  ${STATUS_MARK[s.status]} ${s.step}${s.note ? ` — ${s.note}` : ""}`).join("\n");
  const structured = {
    targetId: target.id,
    sourceIds,
    mode,
    warnings: job.warnings,
    steps: steps.map(({ step, status, note }) => ({ step, status, note })),
  };

  if (failed.length === 0) {
    const kept = mode === "safe" ? " Sources kept (mode=safe)." : "";
    const trashed = mode !== "safe" ? " Sources are in Calibre's trash (recoverable ~14 days)." : "";
    const summary =
      steps.length === 0
        ? `Nothing to do — #${target.id} already has every source format and no metadata differs.`
        : `Merged ${sourceIds.length} source(s) into #${target.id}.${kept}${trashed}`;
    return toolOk([{ type: "text", text: `${summary}\nSteps:\n${ledger}` }], {
      ...structured,
      status: "merged",
    });
  }

  if (!committed) {
    // An unverified step may have committed: never claim nothing changed (#413).
    // a note that ends in its own full stop must not double it before our sentence
    const why = (failed[0]!.note ?? failed[0]!.step).replace(/\.+$/, "");
    const message = failed[0]!.unverified
      ? `Merge stopped — ${why}. That step may have committed; no later step ran.\nSteps:\n${ledger}`
      : `Merge did not start — ${why}. Nothing was changed.\nSteps:\n${ledger}`;
    const opts = { hint: failed[0]!.hint, structured: { ...structured, status: "incomplete" } };
    // the failing step's own cause when it threw; a failed post-add check has none
    const cause = failed[0]!.cause;
    return toolErrorFrom(cause, message, "write_failed", opts);
  }

  // Something committed: NEVER isError (issue #33). Steer: re-running is safe.
  const stop = failed[0]!;
  // one steer, not two: an unverified step is verified first; a note with its own re-run wins (#413)
  const rerun = stop.ownRerun
    ? ""
    : `${stop.unverified ? "Verify first, then re-run" : "Re-run"} the same call to finish — completed steps are ` +
      "idempotent (already-moved formats skip, metadata re-merge is a no-op).";
  return toolOk(
    [
      {
        type: "text",
        text:
          `Merge incomplete — some steps committed, then "${stop.step}" ` +
          `${stop.unverified ? "could not be confirmed" : "failed"}${stop.note ? ` (${stop.note})` : ""}. ` +
          `No data was lost: sources are deleted only after every other step verifies.` +
          `${rerun ? ` ${rerun}` : ""}\nSteps:\n${ledger}`,
      },
    ],
    { ...structured, status: "incomplete" },
  );
}
