# 2026-08-18 — Review sweep 36: the orientation indexes named paths that do not exist

**Agent:** Review 📖 · **Branch:** `review/index-path-drift` · **Docs + one CI check.** Filed and fixed **Q-554**.

`scripts/check-claude-md-paths.js` exists because of Q-153, and its header states the reason exactly:
*"a wrong path in a rulebook is worse than a wrong path in code: nothing compiles it, so it rots
silently and is copied confidently."* That argument does not stop at `CLAUDE.md` — sessions are told
to read `docs/module-map.md` before building any shared helper and `docs/domains/<pillar>/README.md`
before working in a pillar, and **nothing checked either**.

**The sharpest find: `module-map.md:232` carried a row for a module that has never existed.**
`lib/oura-ble/steps-motion-decoder.ts` → `decodeStepsPacket(cols27)` — zero references to either
anywhere in the tree. What exists is the row twenty lines below, `lib/oura-models/steps-motion-decoder.ts`
→ `runStepsMotionDecoder(input)`, golden-verified and described *there* as **"NOT yet wired"** into the
BLE motion-frame decode or the step-counter pipeline. So row 232 described that wiring, in the present
tense, in a table whose stated purpose is *"what already exists and where … to stop new work
re-implementing infrastructure the app already has."* It produced both failures at once: a session
looking for the decoder finds nothing, and a session checking whether the wiring is done reads that it
is. Marked `⚠️ NOT BUILT`, with the real port named and the design intent kept.

Three stale domain-index rows followed: `workouts` listed a UI route `app/history/` (gone — history
renders through `components/exercise-history-sheet.tsx`), `devices` listed `docs/oura-models/` (no such
directory; the ops reference is `docs/oura-ble-operations.md`), and `app-shell` listed `app/overview/`
(no such route, and no page mentions one).

And 49 malformed display paths: every domain index rendered its history links as
a label of `docs` + `/../overview/` + the filename, over a target of `../../overview/` + the same
filename. The link target is right; the visible label is
not, since `docs/../overview/` normalises to `overview/` at the repo root. Harmless to a clicker, wrong
to anyone copying it or reading the index as a map. Fixed across all eleven, link targets untouched.

**The check is now step 42 of 42**, covering 748 paths across 12 documents. Its narrowings were earned
rather than designed: the first pass reported **59 of 787**, and all but four were relative fragments
(`slices/oura.ts`), globs (`components/ui/*.tsx`, `NNN_*.sql`), or the display-path bug. Then the fixes
**re-triggered the check** — writing *"there is no `app/overview/` route"* names the path in backticks
just as surely as claiming it exists, which is what the `DELIBERATE` escape hatch is for; four entries
now carry their reason.

**Not exercised:** existence only. The check verifies that a path resolves, **not** that the description
beside it is accurate — row 232 was caught only because its path happened to be wrong too. A row naming
a real file while describing behaviour it does not have would still pass, and nothing here addresses
that.
