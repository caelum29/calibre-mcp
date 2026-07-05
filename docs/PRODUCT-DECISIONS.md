# PRODUCT-DECISIONS — resolved FABLE-5 deep-dives from PRODUCT-VISION §8

<!-- Decision capture, 2026-07-05 (Fable-5 session with Artem). Resolves §8 items 1 (legality)
     and 2 (versioning + provenance) via a three-agent adversarial pass: legal-doctrine research
     (case law US/EU/UA + summary-service market practice), a plaintiff's-counsel audit of our
     ACTUAL artifacts (SKILL.md recipe + the apache-kafka-ru sample distillate), and a
     versioning/provenance design pass. Items 3–5 remain open. NOT legal advice —
     engineering-decision research. -->

---

## D1 — Legality (§8 item 1): public registry viability

### Verdict

**VIABLE WITH GUARDRAILS — but bifurcated by content type and by artifact layer, and
own-library-only until the mechanical gate (D1.4) ships.**

| Layer / content | Public registry? |
|---|---|
| Own-words, concept-keyed layers (core frameworks, glossary, patterns, cheatsheet) of **factual/technical non-fiction** | ✅ yes, with guardrails |
| Chapter map as **structural metadata** (heading strings + ordinals + position fractions, no prose) | ✅ yes — index-like facts about the work |
| **Per-chapter prose recounts** mirroring the book 1:1 | ⚠️ only after the D1.3 changes (paraphrased titles, no verbatim code/tables, shingle + compression checks) |
| **Fiction / poetry / drama** | ❌ own-library-only, permanently |
| Raw book text, L4 char-offset cursors | ❌ never crosses the wire |

The strongest defense is not "transformative use" — it's the **idea/expression dichotomy**
(17 U.S.C. §102(b)): frameworks, methods, decision-rules and facts are uncopyrightable;
only their expression is. A distillate **re-expressed in the distiller's own words** takes
mostly uncopyrightable material, and technical books carry "thin" copyright. Fair use is
the fallback argument, not the primary one — and it's an affirmative defense with the
burden on us (*Dr. Seuss v. ComicMix*, 9th Cir. 2020).

### D1.1 Legal anchors (verified holdings)

| Case | Holding | What it means for us |
|---|---|---|
| *Twin Peaks v. Publications Int'l* (2d Cir. 1993) | Chapter-by-chapter recount "in the same sequence" = infringing **abridgment** | The 1:1 chapter-map-with-recount is the weak link — our riskiest artifact layer |
| *Castle Rock v. Carol Publishing* (2d Cir. 1998) | Trivia book infringing despite tiny taking + format change; usurped an unentered licensing market | **Compression ratio is NOT dispositive** — 45× doesn't save protected expression |
| *Warner Bros. v. RDR Books* (SDNY 2008) | Reference-guide **purpose accepted as transformative**, but verbatim/close-paraphrase quantity killed it; republished after cutting quotes | Quote caps are the decisive lever; a reference guide per se is legitimate |
| *Authors Guild v. Google* (2d Cir. 2015) | Whole-book scan + snippets fair: information *about* the work, hard caps (<16 %, scattered, opt-out) | The safe-harbor recipe: pointer-into-the-book + strict, non-contiguous quote caps + opt-out |
| *Warhol v. Goldsmith* (SCOTUS 2023) | "New meaning" alone insufficient; shared purpose + commerciality tilt against | If the distillate serves the book's own purpose to the book's own audience, factor 1 weakens |
| *Bartz v. Anthropic* (N.D. Cal. 2025, $1.5 B settlement) | Training fair use, but **pirated acquisition separately actionable** | Lawful-access provenance is load-bearing — a fair output doesn't launder a pirated source |
| *Hachette v. Internet Archive* (2d Cir. 2024) | Even 1:1 owned-to-loaned digital copies infringe | L4's no-copy design is materially safer than CDL: nothing is copied or distributed |
| *Authors Guild / GRRM v. OpenAI* (SDNY 2025, MTD denied) | AI summaries of **fiction** plausibly substantially similar via plot/character/setting | The fiction gate is not optional |

Jurisdiction: US fair use is the *best* reachable forum, not the operative one. EU has a
closed exception list (quotation exception Art. 5(3)(d) InfoSoc: lawful source, attribution,
purpose-bound extent, three-step test; DSM Art. 3/4 TDM covers only the *ingestion* step,
conditioned on **lawful access**). Ukraine's Law № 2811-IX (2022) mirrors the EU quotation
model (Art. 22). A GitHub-hosted global registry answers to the **strictest reachable
forum** → **design to the EU/UA quotation standard**, not to US fair-use breadth.

Market practice: getAbstract (600+ publisher licenses) and Blinkist (partner program)
**licensed instead of litigating**; Shortform/Headway run the own-words posture unlitigated.
The realistic adversary is **DMCA takedowns** (succeed on allegation, cheaply), not a
courtroom.

### D1.2 What the audit found in OUR artifacts (must-fix)

Plaintiff's-counsel pass over `skills/calibre-distill/SKILL.md` + the real
`apache-kafka-ru` sample distillate:

1. **Rule 7 self-contradiction (the plaintiff's gift).** Quality Rule 7 ("never copy raw
   book text") is directly contradicted by three generation steps that order verbatim
   reproduction — "preserve exact syntax" (Step 7 technical emphasis), "Reproduce any
   comparison/parameter/decision table" (Reference Tables), "Reproduce one concrete
   example … faithfully" (Worked Example). The Kafka sample shows reproduction winning:
   lifted Java code blocks and parameter tables (`batch.size`/`linger.ms`,
   `replication.factor 3` / `min.insync.replicas 2`).
2. **1:1 chapter mirror with verbatim headings** (`ch01-meet-kafka.md … ch14-…`, headings
   copied verbatim) — the *Twin Peaks* + compilation (selection-and-arrangement) signature.
3. **Source-map framing + precise cursors in a public artifact.** The E1 footer ships
   char-offset cursors + literal "pull the exact quote" tool calls, and PRODUCT-VISION §1
   frames the product as "can't share books, but **can** share the distillate" — quotable
   inducement language at trial.
4. **Fourth-factor exposure is genre-shaped.** For a technical *reference* book, cheatsheet
   + glossary + patterns IS the daily use of the book — the most-exposed genre is exactly
   the target library. (Benchmark correction: 45.3×/4.6×/8.5× are the same ~5 K-token skill
   vs three *baselines*, not three artifacts; the risk concentrates in the low-local-
   compression cheatsheet/glossary tables, not in a separate artifact.)

### D1.3 Guardrails (the decided set; numeric caps = engineering synthesis, not legal thresholds)

1. **Own-words only** for all substantive layers; close paraphrase of distinctive
   expression counts as copying (RDR).
2. **Verbatim quote budget:** ≤ 25 words per quote, ≤ 200 quoted words total per skill
   (or ≤ 0.5 % of the book, whichever is smaller), non-contiguous, always attributed
   (attribution is a *precondition* of the EU/UA quotation exception, not a courtesy).
3. **No lifted code or tables.** Delete the "preserve exact syntax / reproduce table /
   reproduce faithfully" language from Step 7; code examples and tables are **re-authored**
   (new variable names/scenario/numbers demonstrating the same technique). Worked Examples:
   reconstruct with a fresh scenario, never the author's.
4. **Structure divergence in expressive files:** Topic Index / concepts as primary
   navigation; chapter-file *titles paraphrased*, not the book's verbatim headings. The
   **machine-facing L4 binding** may carry verbatim heading strings + ordinals + position
   fractions — index-like uncopyrightable facts about the work (and D2.4 needs them for
   re-resolution). Expressive files divergent; structural metadata verbatim.
5. **No char-offset cursors in shared artifacts** (converges with D2.4 — they're
   non-portable anyway). ISBN-only L4 binding; the generator's own local footer may keep
   cursors as a same-machine fast path.
6. **Content-type gate:** non-fiction/technical publicly; fiction/poetry/drama
   own-library-only.
7. **Lawful-access attestation** by each skill's publisher (Bartz; also the DSM Art. 3/4
   lawful-access condition). Registry rejects distillates from shadow-library files.
8. **Rightsholder opt-out + fast takedown path**, machine-readable "do-not-distill"
   honored — cheap, and it addresses the *realistic* (takedown) threat directly.
9. **Anti-substitution framing:** attribution + "buy the book" + ISBN block in every skill;
   position as a pointer *into* the book. Drop the "can't share books but can share the
   distillate" line from public-facing docs — keep the framing "a citation layer / index
   over books you own."
10. **Publishing stays own-library-only until the D1.4 gate ships.**

### D1.4 The mechanical gate (E3.1 verifier extensions — all reuse `calibre_search scope=book` FTS)

| Check | Detects | Mechanism |
|---|---|---|
| **Verbatim shingle** | quote/code/table leakage | sliding 8-gram window over every generated file → FTS probe; any hit outside the quote budget = FAIL → regenerate |
| **Compression floor** | abridgment drift | per-chapter-file tokens ≤ X % of source `approxTokens` (already in the Step 2 map); whole skill ≥ 20× |
| **Heading match** | verbatim-ToC mirror in expressive files | compare generated file titles vs `detectChapters` headings; > K matches = FAIL |
| **Cursor regex** | precise cursors leaking into shareable files | reject cursor tokens in any file marked shareable |
| **Attribution grep** | missing attribution/buy-the-book block | structural, model-free |

These are the marketplace admission test's deterministic half (feeds §8 item 5); the
grounding cascade (local NLI flag → frontier confirm) rides on top unchanged.

### D1.5 Residual risks no guardrail removes (if distribution ever happens)

Fair use = burden-on-us defense; DMCA takedowns succeed on allegation regardless of merits
(why the market leaders licensed); ebook EULA/ToS breach survives a copyright win;
factor-4 tension is structural to the summary business; EU/UA closed-list ceiling; moral
rights persist; catalog-scale aggregation can be argued to reconstruct substantial portions
— hold the scatter-and-cap line. A **licensed tier** (getAbstract model) is the only
"clearly safe" endgame; the manifest carries per-skill license metadata (D2.2) so it can
coexist with the fair-use tier later.

### D1.6 Open-source posture + the own-library-only operating model — **DECIDED (Artem, 2026-07-05)**

**Operating model: you distill only books you own, and the generated skills are NOT
distributed.** The tool stays open-source; the artifacts stay private. Consequences:

- **Open-sourcing the engine is safe and orthogonal.** Distributing a dual-use *tool*
  (MIT calibre-mcp + the distill skill) is the photocopier/Betamax position — liability
  attaches to artifacts, not pipelines. "Everyone runs the open pipeline locally on books
  they own" is the strongest legal configuration of the entire product.
- **Open-source does NOT soften the distribution analysis** — kept for the record:
  non-commercial ≠ fair use (*Hachette v. Internet Archive*: a nonprofit giving books away
  free lost flat; US statutory damages need no profit); EU/UA closed-list exceptions don't
  turn on commerciality at all; and a CC license can't launder a derivative — you can only
  license what you own, so an infringing distillate poisons its own license grant downstream.
- **With no distribution, the D1 risk picture collapses:** no distribution right implicated,
  no factor-4 market harm, no DMCA surface, and ownership satisfies the EU/UA lawful-access
  condition for the analysis step. Private study notes on a book you own are ordinary use.
- **Reclassification of the guardrails:** D1.3 #1–#4 (own-words, quote budget, no lifted
  code/tables, structure divergence) drop from *legal wall* to **quality rules +
  future-proofing** — still worth fixing the Rule 7 contradiction so every artifact stays
  *shareable-ready*, but they no longer gate anything. D1.4 becomes an optional quality
  gate, not a legal one.
- **If distribution is ever revisited:** the full D1.1–D1.5 analysis reactivates unchanged,
  and the registry should be structured as a **user-submission platform with a DMCA §512
  safe-harbor process** (registered agent, takedown compliance, repeat-infringer policy) —
  the one place "open/community" materially improves the posture. First-party publication
  by the maintainer gets no safe harbor.
- Residual even in private mode: ebook EULA/ToS terms apply contractually, and DRM-stripping
  would be a separate §1201 issue — calibre-mcp doesn't do it; DRM-free sources only.

**Impact on the product thesis (PRODUCT-VISION §2):** the "missing middle" (distribution)
is deliberately deferred, not designed away. The near-term product = the open generator +
personal library of private skills + topic activation over one's own collection; D2's
manifest/versioning still applies to the *private* collection (upgrades, provenance,
edition changes) and keeps the door open. **What eventually distributes is D1.7.**

### D1.7 The distribution thesis — **topic-aggregate skills, not per-book skills (DECIDED, Artem, 2026-07-05)**

**Per-book distillates stay private (D1.6, raw material). What distributes to the community
is the topic synthesis: a skill built from N books on one topic** ("database design",
"kafka ops"), organized by concept, written as original multi-source authorship.

**Why it's the strongest distributable class (legal geometry flips by construction):**
- The abridgment/*Twin Peaks* attack targets a faithful account of ONE work. A topic skill
  mirrors nobody's structure and takes a thin slice from each source — no single book
  contributes its "heart"; substantial similarity to any one book gets very weak.
- Multi-source synthesis in own words with citations is what every textbook and course does
  — ordinary original authorship. The purpose (comparison, synthesis, "authors disagree on
  X") is genuinely transformative, not "the book's substance, compressed."
- Where sources converge, the content is the field's shared knowledge — fact-like, not any
  author's expression.

**Validity conditions (else it's a per-book skill wearing a topic name):**
1. **Min 3 sources per topic skill** + a **per-source contribution cap** (no source
   dominates; a ~90 %-one-book "topic" skill re-enters the D1 per-book analysis).
2. D1.3 own-words + quote budget apply **per source**.
3. **Full bibliography with ISBNs** — attribution (EU/UA precondition), buy-the-book optics,
   and it doubles as the L4 binding: a recipient who owns Book A gets live-source depth for
   Book A's claims via the D2.4 flow.
4. Non-fiction/technical only; opt-out honored; D1.4 mechanical checks run per source.

**Why it's better product, too:** the topic skill IS the §4 topic bundle, pre-synthesized —
one L1 description instead of N (solves E5 directly), no bundle-resolver needed at
consumption. The machinery mostly exists: Mode 5 (targeted fold-in via in-book search) is
already "fold what N books say about topic X into one skill." Pipeline:
`private per-book distillates (D1.6) → topic synthesis → community`.

**Versioning consequence → D2.8** (per-book `identity = isbn13` doesn't fit a multi-source
artifact).

### D1.7 validation (2026-07-05) — prototype built + shingle-checked

The D1.7 thesis was validated with a **real prototype**: a `kafka-reliability` topic skill
synthesized from 4 Calibre books (SKILL.md + a D2.8-shape `distill.manifest.yaml`), at
`docs/prompts/ideas/distill-samples/topic-kafka-reliability/` (gitignored sample; not
committed). Sources: book 187 *Definitive Guide* 2nd ed RU (ch7–8, contribution 0.40),
571 *Kafka Troubleshooting in Production* (0.25), 182 *Kafka in Action* (ch3/4/6, 0.20),
186 *Kafka Streams/ksqlDB* RU (ch4/12, 0.15).

**Empirical findings that amend the spec:**

a. **The D1.4 verbatim-shingle check ran for real** — 1,695 8-gram shingles vs all 4 source
   texts: **0 prose overlaps**. The only hits were the source book's own TITLE appearing in
   the bibliography → the verifier spec needs a **title/attribution allowlist** (otherwise
   the mandatory bibliography self-trips the shingle gate).
b. **L4 binding needs `n + heading` together, not heading alone.** RU numeric-detector books
   emit bare headings ("ГЛАВА 8") that don't discriminate across chapters — the ordinal is
   load-bearing for re-resolution (amends D2.4 / D2.8's `chapters[]` shape).
c. **Contribution caps are realistic.** The reference book naturally dominates (0.40); the
   ≤0.50 per-source cap (D1.7 validity condition 1) is the right shape — it constrained
   nothing artificial while keeping the "no single book's heart" geometry.
d. **The no-ISBN fallback (D2.1) was exercised live:** book 186 has no ISBN → the manifest
   carries `fallback_key` + `identity_confidence: unverified` (the `isbn13 → olid/oclc →
   work-slug flagged unverified` path, proven end-to-end).
e. **Cost check:** topic-slice reading (~180K chars of chapters across the 4 books) vs
   ~2.8M chars whole-book — **~15× cheaper**; the Mode 5-style targeted-slicing claim holds
   at aggregate scale.

**Cross-source synthesis proved the "original authorship" claim** — content no single-book
distillate can have: KiA's `max.in.flight=1` ordering advice set against DG2's
idempotence-allows-5; KTiP's page-cache gap nuancing DG2's committed-message contract. The
distillate reconciles disagreeing sources, which is exactly the transformative, own-authorship
posture that flips the D1 legal geometry (D1.7 rationale) — and which a faithful single-book
recount structurally cannot produce.

---

## D2 — Versioning + provenance (§8 item 2)

Unifying move: **OCI's identity / digest / tag split.** A book-skill has an *identity*
(what it distills), an immutable *digest* (the exact content — the signed thing), and
movable *tags*. The §5 axes map onto it instead of fighting semver.

### D2.1 Version key — DECIDED

```
identity   = isbn13                      # the EDITION is the identity
digest     = sha256(distillate tree)     # immutable; the attested subject
comparison = { schema, distiller_family, recipe_version, revision, grounding_score }
tags       = { latest, opus-4.8, schema2, … }    # movable display labels
```

- **Edition = identity, work = discovery-only grouping.** Chapter maps, grounding, and L4
  quotes are edition-specific; `work` groups editions for search, never for upgrades.
  *Rejected:* `identity = work` — makes L4 bindings meaningless across editions.
- **`revision`** = monotonic build counter per (identity × lineage); the "newest build"
  tie-break. **Semver fails here:** `edition` and `distiller model` have no semver slot
  (same number, incomparable artifacts). `schema.revision` is display-only ordering
  within one lineage; the tuple is the comparison authority.
- **No-ISBN fallback** (matches the shipped enrich domain): `isbn13` → `olid:`/`oclc:` →
  normalized work-slug flagged `unverified`; run `calibre_extract_isbn` first (E2).

### D2.2 Manifest — DECIDED: YAML sidecar `distill.manifest.yaml`

Separate from SKILL.md frontmatter so provenance never taxes the L1 description budget
(E5). *Rejected:* provenance in frontmatter — an always-loaded token tax.

```yaml
manifest_schema: 1
skill:
  name: huyen-ai-engineering
  digest: "sha256:3f9a…"
  revision: 5
identity:
  isbn13: "9781098166304"
  work: "huyen:ai-engineering"          # discovery grouping only
  title: "AI Engineering"
  authors: ["Chip Huyen"]
  publisher: "O'Reilly Media"
  year: 2025
  language: en
distillate:
  license: "CC-BY-4.0"                  # license of the DISTILLATE, not the book
  transform: "structural-summary"
  compression_ratio: 45.3               # evidence of lossy transform (D1)
  lawful_access: attested               # D1.3 #7
  files: [SKILL.md, "chapters/*.md", glossary.md, patterns.md, cheatsheet.md]
provenance:
  generator: "calibre-mcp"
  generator_version: "0.1.5"
  recipe: "calibre-distill"
  recipe_version: "1.3.0"
  distiller_model: "claude-opus-4-8"
  generated_at: "2026-07-05T14:22:00Z"
  source_content_hash: "sha256:aa17…"   # hash of the EXTRACTED TEXT the distiller read
quality:                                # E3.1 stamp — incl. the D1.4 mechanical checks
  structural: pass
  legal_gate: { shingle: pass, compression_floor: pass, heading_match: pass, cursors: pass }
  grounding: { score: 0.94, sampled: 18, judge_model: "minicheck-7b" }
  frontier_confirmed: true
l4:                                     # portable binding — NO raw cursors (D2.4)
  isbn13: "9781098166304"
  detector: numeric
  chapters:
    - { n: 1, heading: "Introduction to Building AI Applications…", approx_start_frac: 0.03 }
  resolve: >
    calibre_search(identifiers:isbn:…) → local id → calibre_get_content(structure=true)
    → match normalized headings → mint FRESH local cursors.
comparison:
  identity_key: "isbn:9781098166304"
  schema: 2
  distiller_family: "claude-opus-4-8"
  recipe_version: "1.3.0"
  revision: 5
  grounding_score: 0.94
signature:
  method: "github-attestation"
  subject_digest: "sha256:3f9a…"
```

### D2.3 Better-vs-different — DECIDED: total order only within one lineage

A lineage = `identity × schema × distiller_family`. Across lineages it's a partial order:
the client **presents a choice, never silently swaps** a different-model distillate.

```
classify(A installed, B candidate):
  B.identity_key ≠ A → SIBLING            # different edition: offer, never auto-upgrade
  B.schema > A       → UPGRADE_FORMAT     # template migration: recommend + warn
  B.distiller_family ≠ A → SIBLING_ALT    # different model: user's call (show grounding delta)
  # same identity + schema + family — the ONLY auto-upgradeable lineage:
  (B.recipe_version, B.revision) > A  and  B.grounding ≥ A.grounding − ε → UPGRADE_BETTER
  newer but grounding regressed                                          → REGRESSION_FLAG
  else                                                                   → SAME_OR_OLDER
```

*Rejected:* rank everything by grounding score — would auto-swap a distillate the user
chose for voice/consistency over a 0.01 delta.

### D2.4 L4 binding — DECIDED: ISBN-13 + chapter headings; raw cursors never cross the wire

Empirical finding: cursors are **non-portable even for the same edition** — they encode
`{offset,id,format}` into one *local extraction*, and the backend
(pdftotext > PyMuPDF > ebook-convert), format choice (EPUB vs PDF), or a poppler bump all
shift char offsets. A cursor minted on machine X never resolves on machine Y.

Recipient flow: `calibre_search(identifiers:isbn:…)` → `calibre_get_content(structure=true)`
→ `detectChapters` on **their** extraction → match normalized headings → fresh cursors.
Degradation: other-edition ISBN via `work` (warn "quotes may not align") → title+authors →
`calibre_semantic_search(scope=book, query=heading)`.

**Double payoff:** the same decision resolves D1's inducement-optics attack (no precise
index into the text ships) and the portability problem — legal and technical analyses
converged on it independently. `detectChapters` is deterministic on the recipient's own
text, and headings are already produced at generation, so the binding is free.

### D2.5 Reproducibility — DECIDED: artifact-of-record

LLM synthesis is not deterministic; "same model+prompt+book ⇒ same skill" is false. But the
*input* is pinnable: `source_content_hash` proves derivation-from-this-source without
reproducing synthesis. Trust = integrity (digest + signature) + grounding (E3.1 stamp) —
the HuggingFace model-card stance. *Rejected:* re-derive-on-demand — every pull yields a
different artifact, breaking digests, signatures, and comparison.

### D2.6 Signing — DECIDED: GitHub artifact attestations

`actions/attest-build-provenance` over `skill.digest`, verified with
`gh attestation verify` — reuses the exact OIDC/sigstore rails `release.yml` already runs;
effectively SLSA build-provenance L2 for free. *Rejected:* cosign keyless (equivalent
security, second toolchain); bare sha256 index (integrity without authenticity — kept only
as the attested subject).

### D2.7 Constraint exported to §8 item 3 (registry shape)

The **manifest tuple + digest is the comparison authority; any rail's version field is
display-only** (ISBN identity and `{schema, model, revision}` don't fit semver). npm is a
viable *transport* (`npm publish --provenance` = our existing flow) but its `^`/`~`
resolution must be bypassed; a git-tag convention accepts the same manifest + one
attestation per tag. The centralized-vs-decentralized fork stays open — both rails take
this manifest unchanged.

### D2.8 Topic-skill amendment (rides D1.7) — sketch, to firm up with §8 item 3

A topic skill has N source identities, so D2.1 amends for the aggregate class:

```
identity   = topic-slug                    # e.g. "database-design"; the topic is the identity
sources[]  = per-book identity+provenance blocks (isbn13, edition, contribution_frac,
             source_content_hash)          # each ≤ the D1.7 contribution cap
digest / comparison / tags                 # unchanged from D2.1
```

- `comparison` gains `sources_fingerprint` (sorted ISBN list hash). Better-vs-different
  addition: same topic + **superset of sources** + same `schema × distiller_family` lineage
  → `UPGRADE_CANDIDATE` (recommend, show the added sources); overlapping-but-different
  source sets → `SIBLING`.
- L4 binding becomes an **array**: one D2.4 block (ISBN + headings) per source; each
  degrades independently — a recipient lights up L4 only for the books they own. Each
  source's `topic_chapters[]` entries must carry **`{ n, heading }` together** (D1.7
  finding b) — the bare heading doesn't discriminate for RU numeric-detector books.
- The prototype manifest is the **current reference shape** for the aggregate class: it
  added `kind: topic-aggregate` (distinguishes it from the per-book D2.2 manifest) and a
  `quote_budget` block (per-source quote accounting for the D1.3 #2 cap). Firm these into
  the schema when §8 item 3 lands.
- Per-book manifests (D2.2) remain the private-collection format; the topic manifest
  references them by digest when they exist locally (provenance chain: book → per-book
  distillate → topic synthesis).

---

## D3 — Distribution format & registry shape (§8 item 3)

<!-- Resolved 2026-07-05 (Fable-5 session). Three-agent pass: (a) rails research (GitHub §512
     mechanics, npm content policy, gh attestation on non-release artifacts, how existing Claude
     Code plugin marketplaces / skill registries work), (b) an adversarial abuse/gaming/takedown
     pass per rail, (c) a consumer install/activation-UX pass per rail. Designs for the artifact
     that EXISTS (the topic-kafka-reliability skill + D2.8 manifest), the operating model that
     exists (D1.6 private-first), and a solo maintainer with near-zero infra. NOT legal advice. -->

### Verdict

**One GitHub repo carrying a `.claude-plugin/marketplace.json` index is the whole registry.**
The rail is **git-convention on GitHub** (the native Claude Code plugin-marketplace convention);
the index is **a single curated, regenerated JSON file** (the E4 `library-index` generalized);
the submission model is **PR → CI legal-gate in a reusable workflow → merge = listing**, deferred
until distribution opens. npm is rejected as identity/namespace; a hosted service is rejected
outright. The **manifest tuple + digest stays the sole comparison authority** (D2.7) — no rail
version ever enters the trust path. The **same format is zero-overhead for the private "registry
of one"**: a self-contained skill directory in `~/.claude/skills/`, no index and no CI required.

Three findings reshaped the design and are load-bearing below: (1) the **curated index file is the
real namespace AND the real gate chokepoint** — squatting, spam, and bad artifacts all have to pass
*your listing decision*; (2) **manifest fields the gate reads are attacker-controlled** — contribution
fractions and the ≥3-source cap are only real if the gate **recomputes** them from artifact-vs-source
text, never trusts `sources[]`; (3) running the D1.4 gate inside a **reusable workflow the submitter
can't edit** is what makes a GitHub attestation actually *mean* "the trusted gate passed this digest"
(SLSA L3), instead of merely "some workflow produced this file."

### D3.1 Rail — DECIDED: git-convention on GitHub, surfaced as a Claude Code plugin marketplace

The registry is **one GitHub repo** with `.claude-plugin/marketplace.json`. Consumers add it with
`/plugin marketplace add <owner>/<repo>` and install with `/plugin install <topic>@<marketplace>`;
topic skills are subdirectories (`strict:false` + a `skills` array → no per-topic `plugin.json`
boilerplate). This is the dominant real-world pattern (Anthropic's `claude-plugins-official`, the
`awesome-claude-skills` indexes) and the lowest-friction consumer path (native Discover UI,
`/plugin disable` for the L1 token-tax control, native `/plugin marketplace update`).

- **Why GitHub git-convention:** §512 safe harbor comes **free** — GitHub is the service provider,
  the skill author is the "user," so the required user-submission-platform posture (D1.6) collapses
  to a stated takedown contact + repeat-infringer stance + delink-a-JSON-entry on notice. No
  registered agent to run, no takedown infra, no server.
- **Why the marketplace convention specifically:** it *is* a git-convention (a repo + a JSON index),
  so it inherits every git/gh property (owner-scoped namespace, gh attestation, zero infra) while
  giving Claude Code consumers a one-command install + a real update path that raw `gh release
  download` can't.
- **Namespace is owner-scoped, and the index file is the authority.** `caelum29/kafka-reliability`
  can't be globally squatted the way a flat npm name can; bare high-value slugs (`kafka`, `react`)
  are allocated **by the index (curated alias), not by submission order**.
- **Rail version stays display-only (D2.7 honored):** the manifest `digest` + `comparison` tuple is
  the comparison authority; git tags / marketplace pins are labels. gh attestation binds to the
  **digest**, not to a Release or a version.

*Rejected — npm as identity/namespace:* npm's Acceptable-Content policy disfavors markdown-only
packages ("a package cannot simply be … a text document"); the registry is **immutable** (72-h
unpublish window) which directly fights the required takedown flow; its **flat global namespace** is
the historically most-squatted surface (crossenv → the 2026 SANDWORM_MODE Claude-Code squats); and
`--provenance` **won't generate for a private repo**, so it's dead in the D1.6 private phase. npm
survives only as an **optional later transport** for an `npx` installer, never as the trust or
namespace layer. *Rejected — a hosted service:* makes the maintainer the §512 service provider
(own registered agent, staffed takedown queue, direct-infringement liability if the harbor lapses)
and one bulk-takedown campaign can DoS a solo operator into conservative over-removal — it throws
away GitHub's free safe harbor for pure downside. *Rejected — a bare "awesome-list" README index:*
same §512 story but no machine-install path and no structural home for the manifest/attestation
flow; it's a degenerate D3.1 and is fine only as a day-0 placeholder that upgrades into the
marketplace.json form.

### D3.2 Index / discovery — DECIDED: a single curated, regenerated index file (cold-start first)

Discovery is **one `marketplace.json` (+ a human-readable topic table)** that lists each topic skill
with its slug, one-line description, source ISBNs, and a pointer to its content. This is E4's
`library-index` scaled from "which of my books are distilled" to "which topic skills exist."

- **Why an index file, not a search service:** at cold-start (≈10 skills) a regenerated file is
  browsable natively (`/plugin` Discover), greppable, diffable, and needs no server. `gh search`
  and GitHub topics are a free secondary discovery layer.
- **The index is a data file separate from the skill content**, so a takedown of one skill directory
  never nukes the index, and a fork-network DMCA sweep (GitHub has processed one notice against
  4,195 repos) can't take the catalog with it.
- **Semantic topic-resolution (task-phrase → bundle, §8 item 4) rides ON TOP of this index later** —
  the index is the substrate, resolution is a separate open item. Don't over-engineer for 10,000
  skills now; the file scales to a split-repo / static-site UI (the `claude-skill-registry` shape)
  only if volume ever demands it.

*Rejected:* a search service or DB-backed hub at cold-start (infra with no payoff at 10 skills);
npm/GitHub *global* search as the primary entry point (no curation chokepoint, no gate-before-listing).

### D3.3 Submission pipeline — DECIDED: PR → CI legal-gate in a reusable workflow → merge = listing (DEFERRED)

When (if) distribution opens: a contributor **PRs a skill directory + `distill.manifest.yaml`**; CI
runs the **D1.4 legal-gate (the `feat/legal-gate` module) inside a reusable workflow the submitter
cannot edit**, plus manifest/ISBN validation and a SKILL.md prompt-injection lint; a passing run
**attests over the skill digest**; merge into `marketplace.json` = published. Listing requires a
green gate — junk never reaches discovery.

- **Why a reusable (submitter-uneditable) workflow:** it moves the signing material outside submitter
  control → the attestation reaches SLSA L3 → `gh attestation verify … --signer-workflow` now
  genuinely certifies "the **trusted** gate ran and passed **this exact digest**," not "a workflow
  the submitter wrote produced this file." Without it, attestation proves build provenance only and
  vouches for nothing about content.
- **The gate must RECOMPUTE the D1.7 contribution caps and ≥3-source rule from measured
  artifact-vs-source overlap — never read `sources[].contribution_frac` from the manifest.** A
  self-declared cap is theater (submitter writes `0.34/0.33/0.33`); the one-book-abridgment-padded-
  to-fake-3-sources attack only fails if coverage is measured. Add a **minimum absolute contribution
  floor per source** (each real source must clear it) to kill token-source padding.
- **The mechanical gate is a syntactic substitution detector; the paraphrase-substitution boundary
  is where a human/frontier reviewer sits (feeds §8 item 5).** A skilled paraphrase can be a
  100%-coverage functional substitute with near-zero 8-gram overlap and a valid attribution block —
  invisible to shingles. Mitigation: a cheap **semantic-coverage outlier flag** (reuse the shipped
  `multilingual-e5` embedder: skill-section centroids vs each source's section centroids) routes the
  *flagged subset only* to the grounding NLI → frontier reviewer, so the human cost stays bounded.
- **`lawful_access` is an unverifiable, signed, logged liability-shifting claim, not a filter.** No
  mechanical check distinguishes a distillate made from a bought EPUB from one made from a pirated
  PDF. Its function is to (a) shift liability to the submitter and (b) feed an append-only
  submitter→ISBN ledger that makes the repeat-infringer policy enforceable. Market it as
  "gate-verified build," never "legality guaranteed."
- **Curation-as-allowlist beats ranking-by-metric at this scale.** Popularity signals (stars,
  install counts) are Sybil-cheap; the un-fakeable reputation primitive we already own is
  **book-ownership** (L4 lights up only for owned ISBNs → ownership-weighted signals cost the
  attacker actual book purchases). Rank/curate on that, not raw counts (sketch; firms up with §8 #5).

*Rejected:* auto-merge on green (no human eye at the paraphrase-substitution boundary); trusting any
manifest field the gate can recompute; first-party publication by the maintainer (gets no §512 safe
harbor — the submission platform is the point).

### D3.4 Install / activation UX — DECIDED: native plugin install; the topic skill IS the bundle

The consumer journey: **discover** (`/plugin` Discover, native) → **verify** (provenance gated at
publish in CI; the manifest `quality.legal_gate` stamp is visible in-artifact) → **install**
(`/plugin install <topic>@<reg>`, one command) → **activate** (installed = active; `/plugin disable`
+ `--scope project` is the selective-loading / L1-token-tax control) → **update** (`/plugin
marketplace update`). Consumption never requires Calibre.

- **The claude-mode bundle layer collapses to single-skill install for the common case.** A
  topic-aggregate skill is *already* the N-book synthesis, so "install topic X" **is** "activate the
  X bundle" — there is no second bundle format. The claude-mode symlink-a-set pattern (`cm <mode>`)
  re-earns its keep only for a **meta-bundle / "shelf"** (e.g. a Distributed-Systems shelf =
  {consensus, replication, partitioning} topics activated together) — a genuine bundle-of-aggregates,
  and an optional power feature, not v1.
- **L4 "lights up for owned books" — resolved at read time via ISBN, per D2.4.** Don't own the
  source book → the skill answers from its own L1–L3 synthesis (baseline product, no error).
  Own it (calibre-mcp + the book) → `calibre_search(identifiers:isbn:…)` → local id →
  `calibre_get_content(structure=true)` → **match the manifest's stored `{n, heading}` against the
  live chapter table** → mint a **fresh local cursor** → exact quotes / full chapter text (or
  `calibre_semantic_search scope=book` on edition drift). Every rung degrades to the one below
  silently; the cursor is never shipped (D2.4 / D1.3 #5).
- **Consumer-side crypto verification is gated at PUBLISH, not pushed onto the consumer.** Raw
  `gh attestation verify` is per-file, no globs, and demands the consumer understand the manifest
  stamp — most devs skip it (the GPG-check problem). So the CI merge check IS the verification the
  consumer inherits. A thin **`calibre-distill install <topic>` wrapper** (clone → `gh attestation
  verify` → assert `legal_gate: pass` → symlink into the detected skills root → lockfile for
  `update`; the `ccpi` shape) is **DEFERRED** — build it only when consumer-side crypto or
  **cross-host installs** (Copilot `~/.copilot/skills`, Amp `~/.config/agents/skills` — the native
  Claude-Code plugin rail can't reach them) become hard requirements. A documented Rail-A fallback
  (`gh release download` + `gh attestation verify` + symlink) covers non-Claude hosts and skeptics
  meanwhile.

*Rejected:* an npm `postinstall`-copy package (silently broken by `--ignore-scripts`, ambiguous
skills-root target); a mandatory wrapper CLI at cold-start (10 skills don't justify it); shipping
char-offset cursors for L4 (non-portable AND a legal-optics liability — D2.4).

### D3.5 The private half — DECIDED: the same format is a zero-overhead "registry of one"

D1.6 (private, own-library-only) is the operating model **today**, so the format must cost nothing
locally. It does: a topic skill is a **self-contained directory** (`SKILL.md` + `distill.manifest.yaml`)
that drops straight into `~/.claude/skills/` — **no index, no CI, no attestation, no registry**
required to use it. The registry machinery (marketplace.json, the gate workflow, attestation) is
**purely additive** and switches on only if distribution ever opens. The manifest still earns its
keep privately (D2: upgrades, provenance, edition changes across your own collection), and the
local generator MAY keep char-offset cursors in its own copy as a same-machine L4 fast path (D1.3 #5)
— they're simply stripped from anything marked shareable. "Registry of one" = drop a directory in a
folder; "registry of many" = the same directory, PR'd through the D3.3 gate.

### D3.6 Residual open items handed forward

- **Topic-resolution (task-phrase → skill/bundle)** is §8 item 4 — rides on top of the D3.2 index,
  unresolved here.
- **Quality-gate economics / curation** (cost per submission, false-accept tolerance, who curates,
  Sybil resistance) is §8 item 5 — D3.3 supplies its rail-side half (reusable-workflow gate,
  recompute-don't-trust, semantic-coverage flag → frontier on the flagged subset, ownership-weighted
  reputation); the economics firm up there.
- **§512(f) counter-abuse is weak** (the *Lenz* subjective-bad-faith bar is rarely met), so bulk-DMCA
  weaponization is defended structurally (GitHub's process + index-as-data + per-directory takedown
  granularity + a pre-written counter-notice template), not by deterrence.

---

## Follow-up engineering actions (not yet done)

1. **SKILL.md edits (D1.2 #1, #2):** delete/replace the three reproduction orders in
   Step 7 ("preserve exact syntax" → "re-author demonstrating the same technique";
   "Reproduce any … table" → "re-author the decision content"; Worked Example →
   "reconstruct with a fresh scenario"); paraphrase chapter-file titles; add the
   attribution + buy-the-book block to the Step 9 template.
2. **E1 footer split (D1.3 #5 / D2.4):** shareable artifacts get the ISBN+headings L4
   block; char-offset cursors only in the generator's local copy.
3. **E3.1 verifier: implement the D1.4 mechanical checks** (shingle, compression floor,
   heading match, cursor regex, attribution grep) — the gate that flips publishing from
   own-library-only to public.
4. **Manifest emission:** add `distill.manifest.yaml` generation as a distill step
   (schema above, `manifest_schema: 1`).
5. **PRODUCT-VISION.md framing fix (D1.3 #9):** soften §1's "can't share books but can
   share the distillate" to the citation-layer framing.
6. Before any actual public registry launch: **a real legal opinion** on the guardrail set
   — this document de-risks the design, it does not clear it.
7. **Registry repo scaffold (D3.1/D3.2, deferred):** one GitHub repo with
   `.claude-plugin/marketplace.json` (strict:false + a `skills` array) + a regenerated topic
   index + a stated takedown-contact / repeat-infringer policy. Day-0 may be a plain topic
   table that upgrades into marketplace.json.
8. **Submission-gate workflow (D3.3, deferred):** the D1.4 legal-gate wired as a **reusable**
   GitHub workflow (submitter-uneditable → SLSA L3 attestation) + manifest/ISBN validation +
   a SKILL.md prompt-injection lint; passing run attests the digest; merge = listing.
9. **Manifest hardening (D3.3):** the gate must **recompute** `sources[].contribution_frac`
   and the ≥3-source rule from measured artifact-vs-source overlap (never trust the manifest);
   add a per-source minimum-absolute-contribution floor; make the quote budget
   cumulative-per-source. Amends D1.7 / D2.8 (`contribution_frac` becomes gate-emitted, not
   author-declared).
10. **Semantic-coverage outlier flag (D3.3 → §8 #5):** reuse the shipped `multilingual-e5`
    embedder to flag high-coverage / low-overlap artifacts (the paraphrase-substitution
    signature) and route only the flagged subset to the frontier reviewer.
11. **`calibre-distill install <topic>` wrapper (D3.4, DEFERRED):** build only when
    consumer-side crypto verification or cross-host installs (Copilot / Amp roots) become hard
    requirements; raw `/plugin install` + CI-gated publish suffice at cold-start.

## Cross-references

- Open items: PRODUCT-VISION §8 items 4–5 (topic resolution ← rides the D3.2 index;
  quality-gate economics ← D1.4 + D3.3 supply its deterministic + rail-side halves). §8 item 3
  RESOLVED here (D3).
- Generation engine: `skills/calibre-distill/SKILL.md` · Topic engine: `skills/calibre-distill-topic/SKILL.md`
  (branch `feat/distill-topic`) · Legal gate: `src/domain/distill/legal-gate.ts` (branch
  `feat/legal-gate`) · Roadmap: `docs/DISTILL-ROADMAP.md`