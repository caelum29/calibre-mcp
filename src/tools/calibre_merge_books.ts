// calibre_merge_books (spec #50) — DESTRUCTIVE gated write. Mirrors Calibre's GUI merge
// (M / Alt+M / Shift+M): move formats into an explicit target, merge metadata per
// Calibre's rules, trash the sources. Dry-run unless confirm=true; execution is a step
// ledger with delete ALWAYS last, so any abort leaves a superset state (issue #33).

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { buildSetMetadataArgs, changesSatisfied } from "../calibre/metadata-fields.js";
import type { ChangeValue } from "../calibre/metadata-fields.js";
import { downloadToFile } from "../calibre/http.js";
import type { Book } from "../domain/book.js";
import { similarKey } from "../domain/curation/normalize.js";
import { CalibreCliError, CalibreCliTimeoutError, CalibreHttpError } from "../domain/errors.js";
import {
  mergeBuiltinMetadata,
  mergeCustomMetadata,
  planFormatMoves,
} from "../domain/merge.js";
import type { FormatMove } from "../domain/merge.js";
import { CoercedBool, CoercedInt, jsonArray } from "./coerce.js";
import { defineTool } from "./define.js";
import { fence, toolError, toolOk } from "./result.js";
import type { ToolDeps } from "./types.js";
import { isWriteRefused, WRITE_REFUSED_MESSAGE } from "./write-refusal.js";

/** One executed (or planned) write step in the merge ledger. */
interface Step {
  step: string;
  status: "pending" | "done" | "skipped" | "failed" | "not-run";
  note?: string;
}

/** The benign `--dont-replace` collision: target already holds that format (probe §1). */
function isFormatCollision(err: unknown): boolean {
  return err instanceof CalibreCliError && /already exists for book/i.test(err.stderr ?? "");
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
    "Merge duplicate book records: moves formats from source books into a target (target's copy " +
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
    formatMoves: z
      .array(z.object({ format: z.string(), sourceId: z.number(), action: z.string() }))
      .optional(),
    metadataChanges: z.record(z.string(), z.unknown()).optional(),
    steps: z
      .array(z.object({ step: z.string(), status: z.string(), note: z.string().optional() }))
      .optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  write: true,
  handler: async (args, deps) => {
    try {
      const sourceIds = [...new Set(args.sourceIds)];
      if (sourceIds.length === 0) {
        return toolError("Provide at least one source book id in sourceIds.");
      }
      if (sourceIds.includes(args.targetId)) {
        return toolError(
          "sourceIds must not include targetId — the target is the surviving record.",
        );
      }

      // Fresh reads every call: the confirm run re-verifies the sources still exist.
      const allIds = [args.targetId, ...sourceIds];
      const map = await deps.content.booksByIds(allIds, args.library);
      const missing = allIds.filter((id) => !map.get(id));
      if (missing.length > 0) {
        return toolError(
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
        const facts = await Promise.all(
          allIds.map((id) => deps.content.bookMergeFacts(id, args.library)),
        );
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
      const targetKey = similarKey(target);
      for (const s of sources) {
        if (similarKey(s) !== targetKey) {
          warnings.push(
            `Source #${s.id} "${s.title}" does not look like the same work as the target ` +
              `(title/author mismatch). Advisory only — confirm proceeds regardless.`,
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
      return toolError(err instanceof Error ? err.message : String(err));
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
    `Dry run — nothing written. Re-run with confirm=true to execute.\n` +
    fence("MERGE PLAN", lines.join("\n"));
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
async function executeMerge(deps: ToolDeps, job: MergeJob) {
  const { target, sourceIds, mode } = job;
  const libId = await deps.content.resolveLibraryId(job.library);
  const base = deps.config.serverUrl.replace(/\/+$/, "");

  const moves = job.formatMoves.filter((m) => m.action === "moves");
  const moveSteps = moves.map<Step>((m) => ({
    step: `move ${m.format} from #${m.sourceId} to #${target.id}`,
    status: "pending",
  }));
  const hasMetadata =
    mode !== "formatsOnly" &&
    (Object.keys(job.metadataChanges).length > 0 || job.coverFrom !== undefined);
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
        await downloadToFile(
          `${base}/get/${m.format.toUpperCase()}/${m.sourceId}/${encodeURIComponent(libId)}`,
          file,
        );
        await deps.calibre.calibredb(
          ["add_format", "--dont-replace", String(target.id), file],
          { library: libId },
        );
        step.status = "done";
      } catch (err) {
        if (isFormatCollision(err)) {
          step.status = "skipped";
          step.note = "target already has this format";
          continue;
        }
        // A routed write commits server-side before calibredb replies — a timeout is
        // ambiguous, so verify against a re-read before failing (issue #33).
        if (err instanceof CalibreCliTimeoutError) {
          const landed = await deps.content
            .getBook(target.id, job.library)
            .then((b) => b.formats.includes(m.format))
            .catch(() => false);
          if (landed) {
            step.status = "done";
            continue;
          }
        }
        step.status = "failed";
        step.note = isWriteRefused(err)
          ? WRITE_REFUSED_MESSAGE
          : err instanceof Error
            ? err.message
            : String(err);
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
          await downloadToFile(
            `${base}/get/cover/${job.coverFrom}/${encodeURIComponent(libId)}`,
            coverPath,
          );
          changes.cover = coverPath;
        }
        await deps.calibre.calibredb(buildSetMetadataArgs(target.id, changes), {
          library: libId,
        });
        metaStep.status = "done";
      } catch (err) {
        let handled = false;
        if (err instanceof CalibreCliTimeoutError) {
          // Verify on the built-in subset (custom #columns aren't carried on Book).
          const builtin = Object.fromEntries(
            Object.entries(job.metadataChanges).filter(([k]) => !k.startsWith("#")),
          );
          if (Object.keys(builtin).length > 0) {
            const landed = await deps.content
              .getBook(target.id, job.library)
              .then((after) => changesSatisfied(target, after, builtin))
              .catch(() => false);
            if (landed) {
              metaStep.status = "done";
              handled = true;
            }
          }
          if (!handled) {
            metaStep.status = "failed";
            metaStep.note =
              "calibredb timed out and the re-read does not confirm the metadata merge — " +
              `verify with calibre_get_book id=${target.id} before retrying`;
            aborted = true;
            handled = true;
          }
        }
        if (!handled) {
          metaStep.status = "failed";
          metaStep.note = isWriteRefused(err)
            ? WRITE_REFUSED_MESSAGE
            : err instanceof Error
              ? err.message
              : String(err);
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
        let handled = false;
        if (err instanceof CalibreCliTimeoutError) {
          // Removed books 404 immediately on /ajax (probe §4) — all gone = committed.
          const gone = await Promise.all(
            sourceIds.map((id) =>
              deps.content.getBook(id, job.library).then(
                () => false,
                (e) => e instanceof CalibreHttpError && e.status === 404,
              ),
            ),
          );
          if (gone.every(Boolean)) {
            removeStep.status = "done";
            handled = true;
          }
        }
        if (!handled) {
          removeStep.status = "failed";
          removeStep.note = isWriteRefused(err)
            ? WRITE_REFUSED_MESSAGE
            : err instanceof CalibreCliTimeoutError
              ? "calibredb timed out and sources still exist — re-run to finish the merge " +
                "(formats and metadata are already on the target; re-merging is a no-op)"
              : err instanceof Error
                ? err.message
                : String(err);
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
  const ledger = steps
    .map((s) => `  ${STATUS_MARK[s.status]} ${s.step}${s.note ? ` — ${s.note}` : ""}`)
    .join("\n");
  const structured = {
    targetId: target.id,
    sourceIds,
    mode,
    warnings: job.warnings,
    steps: steps.map(({ step, status, note }) => ({ step, status, note })),
  };

  if (failed.length === 0) {
    const kept = mode === "safe" ? " Sources kept (mode=safe)." : "";
    const trashed =
      mode !== "safe" ? " Sources are in Calibre's trash (recoverable ~14 days)." : "";
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
    return toolError(
      `Merge did not start — ${failed[0]!.note ?? failed[0]!.step}. Nothing was changed.\n` +
        `Steps:\n${ledger}`,
      { ...structured, status: "incomplete" },
    );
  }

  // Something committed: NEVER isError (issue #33). Steer: re-running is safe.
  return toolOk(
    [
      {
        type: "text",
        text:
          `Merge incomplete — some steps committed, then "${failed[0]!.step}" failed` +
          `${failed[0]!.note ? ` (${failed[0]!.note})` : ""}. No data was lost: sources are ` +
          `deleted only after every other step verifies. Re-run the same call to finish — ` +
          `completed steps are idempotent (already-moved formats skip, metadata re-merge is ` +
          `a no-op).\nSteps:\n${ledger}`,
      },
    ],
    { ...structured, status: "incomplete" },
  );
}
