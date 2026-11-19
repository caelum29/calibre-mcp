// Cleaned ↔ raw position map of the text-normalisation stage (#655, ADR-0033). Every offset the
// server hands out is in cleaned coordinates; this map leads back to the converter's raw output
// (first use: the one-time remap of eval labels that carry version-4 offsets). It holds one entry
// per changed span, not per character: between two edits both texts are identical, so positions
// shift by a constant. Pure, SDK-free, no npm imports.

/** One replacement: input `[inStart, inEnd)` became output `[outStart, outEnd)`. */
export interface TextEdit {
  inStart: number;
  inEnd: number;
  outStart: number;
  outEnd: number;
}

/** Raw → cleaned edits in document order (in = raw text, out = cleaned text); no two edits touch. */
export interface OffsetMap {
  readonly edits: readonly TextEdit[];
}

/** A zero-length insertion of `length` chars at input offset `at` (figure-marker lines). */
export interface Insertion {
  at: number;
  length: number;
}

/** The identity map (text unchanged). */
export const IDENTITY_MAP: OffsetMap = { edits: [] };

/**
 * The raw position a cleaned position comes from. Inside a replacement it clamps to the raw
 * span (`ﬁ` → `fi`: both cleaned chars map to the ligature); after it, the shift is constant.
 */
export function toRaw(map: OffsetMap, pos: number): number {
  return project(map.edits, pos, "out");
}

/** The cleaned position a raw position lands on (the inverse of {@link toRaw}; monotone). */
export function toCleaned(map: OffsetMap, rawPos: number): number {
  return project(map.edits, rawPos, "in");
}

/** Map `pos` from one side of the edits (`from`) to the other. */
function project(edits: readonly TextEdit[], pos: number, from: "in" | "out"): number {
  const start = (e: TextEdit) => (from === "out" ? e.outStart : e.inStart);
  const end = (e: TextEdit) => (from === "out" ? e.outEnd : e.inEnd);
  const otherStart = (e: TextEdit) => (from === "out" ? e.inStart : e.outStart);
  const otherEnd = (e: TextEdit) => (from === "out" ? e.inEnd : e.outEnd);
  // last edit starting at or before pos (binary search; starts are strictly increasing)
  let lo = 0;
  let hi = edits.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (start(edits[mid]!) <= pos) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return pos;
  const e = edits[found]!;
  if (pos < end(e)) return otherStart(e) + Math.min(pos - start(e), otherEnd(e) - otherStart(e));
  return otherEnd(e) + (pos - end(e));
}

/** Edits for zero-length insertions (sorted by `at`), e.g. figure markers added after cleaning. */
export function insertionEdits(insertions: readonly Insertion[]): TextEdit[] {
  const edits: TextEdit[] = [];
  let shift = 0;
  for (const ins of [...insertions].sort((a, b) => a.at - b.at)) {
    if (ins.length <= 0) continue;
    edits.push({ inStart: ins.at, inEnd: ins.at, outStart: ins.at + shift, outEnd: ins.at + shift + ins.length });
    shift += ins.length;
  }
  return mergeTouching(edits);
}

/**
 * Compose two passes: `first` maps text A → B, `second` maps B → C; the result maps A → C.
 * Edits that overlap or touch in B merge into one (positions inside a merged span clamp, the
 * spans themselves stay exact), so the result keeps the "no two edits touch" invariant.
 */
export function composeEdits(first: readonly TextEdit[], second: readonly TextEdit[]): TextEdit[] {
  // both lists as intervals in B coordinates, tagged with their length change
  interface Span {
    lo: number;
    hi: number;
    dFirst: number; // (A length − B length) of a first-pass edit
    dSecond: number; // (C length − B length) of a second-pass edit
  }
  const spans: Span[] = [];
  let i = 0;
  let j = 0;
  while (i < first.length || j < second.length) {
    const a = first[i];
    const b = second[j];
    if (b === undefined || (a !== undefined && a.outStart <= b.inStart)) {
      spans.push({
        lo: a!.outStart,
        hi: a!.outEnd,
        dFirst: a!.inEnd - a!.inStart - (a!.outEnd - a!.outStart),
        dSecond: 0,
      });
      i += 1;
    } else {
      spans.push({ lo: b.inStart, hi: b.inEnd, dFirst: 0, dSecond: b.outEnd - b.outStart - (b.inEnd - b.inStart) });
      j += 1;
    }
  }
  const out: TextEdit[] = [];
  let shiftA = 0; // A − B before the current cluster
  let shiftC = 0; // C − B before the current cluster
  let k = 0;
  while (k < spans.length) {
    const lo = spans[k]!.lo;
    let hi = spans[k]!.hi;
    let dA = 0;
    let dC = 0;
    // a cluster: spans that overlap or touch in B
    while (k < spans.length && spans[k]!.lo <= hi) {
      hi = Math.max(hi, spans[k]!.hi);
      dA += spans[k]!.dFirst;
      dC += spans[k]!.dSecond;
      k += 1;
    }
    out.push({ inStart: lo + shiftA, inEnd: hi + shiftA + dA, outStart: lo + shiftC, outEnd: hi + shiftC + dC });
    shiftA += dA;
    shiftC += dC;
  }
  // an insertion cancelled by a deletion of the same span leaves nothing to record
  return out.filter((e) => e.inEnd > e.inStart || e.outEnd > e.outStart);
}

/** Merge edits that overlap or touch on the input side (they are sorted by input position). */
export function mergeTouching(edits: readonly TextEdit[]): TextEdit[] {
  const out: TextEdit[] = [];
  for (const e of edits) {
    const last = out[out.length - 1];
    if (last && e.inStart <= last.inEnd) {
      last.inEnd = Math.max(last.inEnd, e.inEnd);
      last.outEnd = Math.max(last.outEnd, e.outEnd);
    } else {
      out.push({ ...e });
    }
  }
  return out;
}

/**
 * Compact text form for storage (one row per book): `m1:` + comma-separated triples
 * `gap,rawLen,cleanLen`, where `gap` is the unchanged run before the edit — the same length on
 * both sides, so a triple is all an edit needs.
 */
export function encodeOffsetMap(map: OffsetMap): string {
  const parts: number[] = [];
  let prevIn = 0;
  for (const e of map.edits) {
    parts.push(e.inStart - prevIn, e.inEnd - e.inStart, e.outEnd - e.outStart);
    prevIn = e.inEnd;
  }
  return `m1:${parts.join(",")}`;
}

/** Decode {@link encodeOffsetMap}'s form; undefined when the string is not a valid map. */
export function decodeOffsetMap(s: string): OffsetMap | undefined {
  if (!s.startsWith("m1:")) return undefined;
  const body = s.slice(3);
  if (body === "") return { edits: [] };
  const nums = body.split(",").map(Number);
  if (nums.length % 3 !== 0 || nums.some((n) => !Number.isInteger(n) || n < 0)) return undefined;
  const edits: TextEdit[] = [];
  let inPos = 0;
  let outPos = 0;
  for (let k = 0; k < nums.length; k += 3) {
    const [gap, rawLen, cleanLen] = [nums[k]!, nums[k + 1]!, nums[k + 2]!];
    const inStart = inPos + gap;
    const outStart = outPos + gap;
    edits.push({ inStart, inEnd: inStart + rawLen, outStart, outEnd: outStart + cleanLen });
    inPos = inStart + rawLen;
    outPos = outStart + cleanLen;
  }
  return { edits };
}
