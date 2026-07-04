# PRODUCT-VISION — topic-activated, versioned registry of book-derived Agent Skills

<!-- Design capture, 2026-07-05 (Claude Code session with Artem). Concept-only — nothing
     here is committed as a build plan. This is the strategic frame that sits ABOVE
     calibre-distill (the generation engine) and connects it to claude-mode (the activation
     pattern). Read skills/calibre-distill/SKILL.md and docs/DISTILL-ROADMAP.md first. -->

> **🔬 FABLE-5 DEEP-DIVE markers.** Blocks tagged `🔬 FABLE-5` are open questions that need a
> deeper, adversarial reasoning pass before they become build decisions. They are load-bearing
> (they either make the product or kill it) and are deliberately left unresolved here — do not
> paper over them. A consolidated agenda is at the end (§8).

---

## 1. Thesis (one line)

Developers can't legally share books, but they **can** share the *distillate* of a book — a
lossy, transformative Agent Skill (frameworks, glossary, cheatsheet, decision-rules). So the
product is a **topic-activated, versioned registry of book-derived skills**: a developer
working on a task ("marketing", "designing a database") preloads a topic bundle and gets the
compressed expert knowledge of N books as an always-available, low-token, on-demand layer —
without anyone shipping a copyrighted file.

---

## 2. Three-layer architecture (2 of 3 already exist)

| Layer | Role | Status |
|---|---|---|
| **Generation** | book → versioned skill (distillate) | ✅ `calibre-distill` (built) — `calibre_get_content structure=true` chapter map + in-book search |
| **Distribution** | share skills (not books), versioned, topic-indexed | ❌ **the missing middle — this is "the product"** |
| **Activation / composition** | group skills by topic, preload for the task at hand | ✅ pattern proven in `claude-mode` (`modes/<topic>` ← symlink `.claude`) |

The generator and the activation UX already exist independently. The product is the
**registry + topic-resolver** that connects them and makes the artifacts shareable.

`claude-mode` reference (prior art): `/Users/artem/WebstormProjects/claude-specs/claude-mode`
— "switchable Claude Code configurations via symlinks; like dotfiles, but for AI workflows."
A *mode* is a directory of agents/skills/commands; `cm <mode>` symlinks `.claude → modes/<mode>`.
A **topic bundle** in this product is the same shape: a set of book-skills activated together.

---

## 3. The core unlock — distillate ≠ book, with graceful L4 degradation

The legal moat and the technical elegance are the same mechanism:

```
L1–L3  distillate (name/description → SKILL.md body → chapters/*.md)
         → PUBLIC, shareable to anyone. Transformative, lossy by design.
L4     live source via calibre-mcp (exact quotes, full chapter text)
         → lights up ONLY if the RECIPIENT owns that book in their own Calibre.
```

So the shared artifact is a **source-map**; the source (the book) stays with whoever legally
owns it. A recipient who owns the book gets L4 deep-source access against *their own* library;
a recipient who doesn't still has the standalone distillate. The artifact **degrades
gracefully** — distillate for everyone, live-source for owners — which is both the UX story and
the legal story.

> **🔬 FABLE-5 DEEP-DIVE — legality.** "Transformative / lossy" is *plausible*, not free. A
> distillate that quotes at length or mirrors the book's structure 1:1 drifts toward a
> derivative work. **Quality Rule 7 ("never copy raw book text") is not a quality rule here —
> it is the load-bearing legal wall.** Needs a real answer, not hand-waving: (a) what makes the
> compression *provably* lossy/transformative (quote-length caps? structure-divergence?
> ratio thresholds vs the §4.1 benchmark's 45×?); (b) attribution + "buy the book" obligations;
> (c) does the sharer need to *own* the source book to publish its skill; (d) jurisdiction
> (US fair use vs EU/UA); (e) publisher-relations / opt-out posture. This gate decides whether
> a public registry is viable at all or whether it must be own-library-only.

---

## 4. Topic activation — solves the L1-budget problem the roadmap already flagged

Artem's framing: *"all book-skills load; I'm designing a DB and want only DB skills."* This is
`DISTILL-ROADMAP.md` **E5 (L1 budget)** + **E4 (`library-index`)** scaled from one personal
library to a shared registry:

- You do **not** load every skill (50 installed skills = 50 always-loaded descriptions taxing
  every session — E5).
- A **topic-resolver** maps a task phrase → topics → a skill *bundle*, activated together
  (the `cm database` move from claude-mode).
- `library-index` (E4) generalizes from "which of *my* books are distilled" to the **registry
  index** — an index-first entry point so the agent queries one index, then pulls one bundle,
  instead of scanning N skill descriptions.

> **🔬 FABLE-5 DEEP-DIVE — topic resolution.** How does `"designing a database"` resolve to the
> right bundle? Options to weigh: semantic match over skill descriptions (reuse the
> multilingual-e5 embedder?), a curated topic taxonomy, tag-based (the `distilled` + topic tags
> from Step 9.5), or a hybrid. Cold-start (few skills) vs scale (thousands) behave differently.
> Also: bundle *granularity* — one topic = one bundle, or composable overlapping bundles?

---

## 5. Version semantics — version of *what*?

A book-skill is not one artifact drifting on one axis. Three axes move independently:

1. **Book edition** — Kafka 2nd ed vs 3rd ed are different sources.
2. **Distiller** — the same book distilled by Opus 4.8 vs Sonnet vs a local model yields
   different skills (different synthesis quality/voice).
3. **Skill schema** — the SKILL.md template / footer format evolves (e.g. adding the L4 footer).

So the version key is roughly `edition × distiller-model × schema-version`, not a single
semver. Two "v2" skills of the same book can be incomparable if they differ on axis 2 or 3.

> **🔬 FABLE-5 DEEP-DIVE — versioning + provenance.** Design the version key and the update/diff
> story: how does a consumer know a newer skill is *strictly better* vs merely *different*?
> How do L4 cursors (which encode `{offset,id,format}`) survive an edition change (they don't —
> ISBN fallback per E2)? Reproducibility: is a distiller run deterministic enough to re-derive,
> or is the skill the only artifact of record? Signing / integrity for community submissions?

---

## 6. What exists vs what's missing

**Exists (reusable):**
- `calibre-distill` skill — the generation engine (book → skill), EN + RU/UK chapter mapping.
- `calibre_get_content structure=true` — chapter map + per-chapter cursors (shipped, PR #16).
- `claude-mode` — the activation/composition UX (modes = topic bundles via symlink).
- `DISTILL-ROADMAP.md` — E4 `library-index`, E5 L1-budget, E3.1 verifier (the quality gate).

**Missing (the product):**
- A **distribution format** — Calibre-independent skill package (plain skill dir + manifest +
  version key + attribution). Generation uses calibre-mcp; *consumption must not require it*.
- A **registry** — where versioned skills live, searchable by topic.
- A **topic-resolver + bundle-activator** — the "preload skills for X" mechanism.
- A **quality gate** — community skills vary; the E3.1 verifier (local/cheap grounding checker
  → frontier confirm) becomes the marketplace's admission test, not just an internal check.

> **🔬 FABLE-5 DEEP-DIVE — distribution format & registry shape.** Is the registry a new service,
> a git-based convention (skills as repos/tags, like claude-mode modes), or does it ride an
> existing rail (npm packages? the MCP Registry? a `gh`-based skill index)? The format must
> carry: distillate files, version key (§5), attribution/licence, optional L4 binding metadata
> (ISBN so an owner's Calibre can re-resolve), and a quality/provenance stamp. Decentralized
> (git tags) vs centralized (a curated hub) is a fork with big downstream consequences.

---

## 7. Non-goals / guardrails (carried from the distill philosophy)

- **Not a book-sharing service.** Only distillate crosses the wire; the book never does. This
  is the whole premise — violating it collapses the legal position (§3).
- **Not batch-distill-everything.** Per-book quality must be validated first; unbounded cost.
  (DISTILL-ROADMAP non-goal, reaffirmed.)
- **No auto-install / no "AI owns the skills root."** Activation is user-invoked (claude-mode's
  `cm` is explicit; keep it that way).
- **Consumption is Calibre-optional.** calibre-mcp is the *generator* and the *L4 escape hatch*
  — never a hard dependency for reading a shared skill.

---

## 8. FABLE-5 deep-dive agenda (consolidated)

Run these as an adversarial reasoning pass; each is a make-or-break decision left open above.

1. **Legality (§3)** — is a *public* registry viable, or own-library-only? What makes the
   distillate provably transformative; attribution/ownership obligations; jurisdiction;
   publisher posture. **Highest stakes — decide first.**
2. **Versioning + provenance (§5)** — the `edition × distiller × schema` key; better-vs-different
   diffing; L4-cursor survival across editions; reproducibility; signing.
3. **Distribution format & registry shape (§6)** — new service vs git-convention vs existing
   rail; what the package carries; decentralized vs centralized.
4. **Topic resolution & bundle model (§4)** — task-phrase → bundle mechanism; taxonomy vs
   embeddings vs tags; cold-start vs scale; bundle granularity/composability.
5. **Quality gate economics (§6)** — the E3.1 cascade (local grounding checker → frontier
   confirm) as the marketplace admission test: cost per submission, false-accept tolerance,
   who curates, gaming resistance.

**Recommendation (from this session):** nail #1 and #2 before any engineering — they either
make the product or kill it. #3–#5 are engineering Artem already knows how to do.

---

## Cross-references

- Generation engine: [`skills/calibre-distill/SKILL.md`](../skills/calibre-distill/SKILL.md)
- Enhancements & the L4 / verifier ideas: [`docs/DISTILL-ROADMAP.md`](./DISTILL-ROADMAP.md)
- Activation prior art: `claude-mode` (`/Users/artem/WebstormProjects/claude-specs/claude-mode`)
