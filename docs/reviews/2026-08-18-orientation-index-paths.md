# Review — the orientation indexes named paths that do not exist

**Date:** 2026-08-18 · **Agent:** Review 📖 · **Sweep 36** · **Finding:** Q-554 (filed and fixed here)

## Why this lens

`scripts/check-claude-md-paths.js` exists because of Q-153: the monorepo extraction moved nine
modules to `packages/shared/src/` and `CLAUDE.md` kept naming them under `lib/`, including in a
section the document itself labels *"a strict rule"*. Its header states the reason precisely — *"a
wrong path in a rulebook is worse than a wrong path in code: nothing compiles it, so it rots silently
and is copied confidently."*

That argument does not stop at `CLAUDE.md`. Sessions are told to read `docs/module-map.md` before
building any shared helper, and `docs/domains/<pillar>/README.md` before working in a pillar.
**Nothing checked either.**

## What was found

Four genuine defects, plus one systematic display-path error appearing 49 times.

### `docs/module-map.md:232` — a row for a module that has never existed

```
| Steps gait-feature decoder (physical units) | `lib/oura-ble/steps-motion-decoder.ts`
  → `decodeStepsPacket(cols27)` / `decodeColumn(...)` — byte-exact port of Oura steps_motion_decoder …
```

**Neither the file nor the function exists anywhere in the tree** — `decodeStepsPacket` has zero
references across `lib/` and `packages/`. What does exist is the row twenty lines below:
`lib/oura-models/steps-motion-decoder.ts` → `runStepsMotionDecoder(input)`, golden-verified, and
described there as *"Library port — **NOT yet wired** into the ring's motion-frame decode … or the
step-counter pipeline."*

So row 232 describes **that wiring** — planned work — in the present tense, in a table whose stated
purpose is *"what already exists and where … to stop new work re-implementing infrastructure the app
already has."* A row for something unbuilt is the one failure that map cannot afford: it produces
both errors at once. A session looking for the decoder finds nothing and may conclude the map is
untrustworthy; a session checking whether the wiring is done reads that it is.

**Fixed** by marking the row `⚠️ NOT BUILT`, naming the real port, and keeping the design intent.

### Three stale rows in the domain indexes

| Index | Claimed | Reality |
|---|---|---|
| `workouts/README.md:21` | UI route `app/history/` | No such route. History renders in place via `components/exercise-history-sheet.tsx`, opened from `session-select` and `stats`. |
| `devices/README.md:17` | `docs/oura-models/` | No such directory. The operational reference is `docs/oura-ble-operations.md`. |
| `app-shell/README.md:18` | `app/overview/` | No such route, and no page mentions one. |

### 49 malformed display paths

Every domain index rendered its history links with a label of `docs` + `/../overview/` + the filename,
pointing at a target of `../../overview/` + the same filename.
The **link target is correct**; the visible label is not — `docs/../overview/` normalises to
`overview/` at the repo root, which does not exist. Harmless to a clicker, wrong to anyone copying
the path or reading the index as a map. Fixed to `docs/overview/…` across all eleven, leaving the
link targets untouched.

## The check

`scripts/check-index-doc-paths.js`, now step **42 of 42** in Custom Rules. It reports
**748 paths across 12 orientation docs**.

It is deliberately narrower than its `CLAUDE.md` sibling, because these documents are prose-heavy and
a noisy check gets switched off:

- only backticked paths **anchored at a known top-level directory** — relative fragments like
  `slices/oura.ts` or `entries/2026-08-17-….md` are resolved against prose context, not the repo root;
- **globs, ellipses and templates are skipped** — `components/ui/*.tsx`, `NNN_*.sql`, `e2e/**` are
  patterns, not paths;
- a path a document names **while saying it is gone** needs a `DELIBERATE` entry with a reason, the
  same escape hatch the sibling uses.

**Those narrowings were earned, not designed.** The first pass reported **59** of 787 paths. All but
four were noise of exactly those three kinds — and the fixes in this PR then *re-triggered* the check,
because writing *"there is no `app/overview/` route"* names the path in backticks just as surely as
claiming it exists. That is what `DELIBERATE` is for, and four entries now carry their reason.

## Why it matters

These are the documents a session reads *before* it is allowed to start. `CLAUDE.md`'s own rule says
to check the module map first *"to stop new work re-implementing infrastructure the app already
has"* — so a wrong row there causes the specific waste the rule exists to prevent, and does it to a
session that followed the instructions correctly.

## Not exercised

Static existence checks only. The check verifies a path **resolves**, not that the description beside
it is accurate — row 232's prose was caught only because its path happened to be wrong too. A row
naming a real file while describing behaviour it does not have would still pass, and nothing here
addresses that.
