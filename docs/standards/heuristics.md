# Standards: heuristics, text and keys

Applies to extraction, captions, chapter maps, ISBN scan, raw-filename detection, duplicate keys,
normalizers, scores and confidence values. The libraries are EN + RU technical books with many raw
filenames; every heuristic here was first tuned on a handful of samples and then broke on the
corpus (#18, #101, #107, #116, #198, #200, #241).

## Negative fixture

- Each new or widened heuristic ships with at least one false-positive fixture taken verbatim from a
  real book, alongside the positive case (#116, #207's `Clean Code (Robert C. Martin Series)`).
- Heuristics touching stored data cite a read-only library sweep (before/after counts) in the PR.

## Not just ASCII

- For any key, normalizer or tokenizer, ask what it returns for a Cyrillic, CJK and accented title.
  `[a-z0-9]` character classes are findings; accent folding goes through `foldAccents` (CI blocks
  a second `normalize("NFKD")`, which strips `й` to `и`, #241, #277).
- An empty key means "not comparable" — never a group, never a lookup (#241, #200's "Cover").
- Language-specific word lists (chapter words, stop words) carry both EN and RU (PR #16).

## Calibre sentinels

- Calibre fields use sentinels (`0101-01-01` pubdate, `Unknown` author). Truthiness checks on raw
  Calibre values are findings; use `isEmptyDate` and the existing helpers (#157).

## Confidence has a basis

- Every score or confidence threshold names what stops a wrong-but-confident answer (ad ISBNs from
  back matter scored 0.95, #198), and its source (eval, sweep, or explicit guess).

## Derived-data versions

- If the diff changes extracted text, offsets, chunking, markers, the figure inventory, or a cached
  envelope's shape, it bumps the matching constant (`TEXT_CACHE_VERSION`, `INVENTORY_VERSION`,
  `INDEX_VERSION`) or states why not, plus the re-index impact.
- Prefer additive nullable columns with a fallback over an `INDEX_VERSION` bump (#205).
- A version number taken by another branch since this one forked is a merge finding (#169).
