# LA-138 — correcting a measurement I filed wrong yesterday

**Branch:** `lane-a/la138-correct-the-phase-claim` · Lane A · **docs only.** No code, no behaviour
change. This exists because I put a false measurement into the queue and it would have sent the
next session to fix something that is not broken.

## What I filed, and why it was wrong

Building TN-64(b) I filed LA-138 claiming **"`program_phases` holds 0 rows for all five
programs"**, and concluded the in-deload suppression had never suppressed anything.

The zero came from a query joining `program_phases` on **`program_id`**. Phases are keyed by
**`phase_set_id`**; `program_id` is a legacy column left behind by that refactor and is **NULL on
all 46 rows**. The join matched nothing and returned a clean, confident zero — no error, no
warning.

That is precisely the failure the External API field-name rule in `CLAUDE.md` is written for: a
wrong key reads as absent and fails silently. I hit it in a diagnostic query rather than in product
code, where nothing typechecks it and no test covers it. Worth noting because the rule is filed
under *external* APIs, and this was our own schema.

## What is actually true

`program_phases` holds **46 rows across 8 phase sets**, **8 of them deload phases**.

| program | mode | phase set | phases |
|---|---|---|---:|
| Bankai (**active**) | `ai_dynamic` | none | 0 |
| Shikai | `ai_dynamic` | none | 0 |
| AI-Phase1 | `ai_dynamic` | none | 0 |
| Main | `automatic` | yes | 6 |
| Strength + Hypertrophy | `automatic` | yes | 6 |

`listProgramPhases` resolves through `programs.phase_set_id` and returns `[]` when there is none.
So the suppression works exactly as written for the two `automatic` programs, and is absent on any
`ai_dynamic` one — **by design, because that mode periodizes dynamically instead of from a fixed
set.**

The narrower finding survives: since TN-64(b) extended the early-deload gate to `ai_dynamic`, the
active program is gated with no in-deload suppression. But the fix is **not** to populate
`program_phases`, which is what my original entry pointed at. The open question is whether the gate
should consult `ai_dynamic`'s own deload notion — `ai-dynamic.ts` carries an elevated-temperature
trigger. Worst case today is a redundant prompt, since every early deload waits on the owner.

## Why the correction is in the entry rather than a quiet edit

The entry now quotes the wrong version before giving the right one. A silently-corrected entry
reads as though it was always right, and the next reader has no way to know the obvious query shape
returns a false zero. The trap is cheaper to document than to re-discover.

## Verification

Custom Rules **78 of 78** · `check-backlog-pointers` OK. No code changed. Every figure is a
`claude_ro` read, **row-scoped to the owner**.

## Not done

**No code.** The gate keeps its current behaviour; whether `ai_dynamic`'s deload state should feed
it is left open on the entry.

**`program_phases.program_id` is dead** — 0 of 46 populated. Dropping it is a migration and belongs
to whoever next touches that table.
