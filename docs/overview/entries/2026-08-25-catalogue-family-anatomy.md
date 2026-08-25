# 2026-08-25 — the shrug and glute-bridge families follow their sibling (LA-24 Kind 2)

**Branch:** `fix/catalogue-family-anatomy` · **Lane A** · migration **224**, v1.375.1.

Migration 219 shipped LA-24's Kind 1 — the five rows another family member already answered — and
deliberately left Kind 2 out, because BF-16a's additions to `Barbell Shrug` and `Barbell Hip Thrust`
came from anatomy with **no in-catalogue precedent**. Extending them to the rest of each family is the
same judgement made five more times, and 219's own comment says making it unasked is how a catalogue
drifts by assertion. **The owner decided it on 2026-08-25: yes, follow the barbell version.**

## What changed

Verified against production immediately before writing, after 216 and 219 had applied there:

| row | was | now matches |
|---|---|---|
| `Dumbbell Shrug` | traps | `Barbell Shrug` — + upper back, forearms |
| `Machine Shrug` | traps | ditto |
| `Barbell Glute Bridge` | glutes, hamstrings | `Barbell Hip Thrust` — + quads, lower back, adductors |
| `Bodyweight Glute Bridge` | glutes, hamstrings | ditto |
| `Single Leg Hip Thrusts` | glutes, hamstrings | ditto |

Thirteen appends across seven rows (two families of the corrected siblings plus five corrected rows).

## The decision was "for now", and the migration says so

The owner's answer carried that qualifier, so the reversal note in `224`'s header is not boilerplate.
The entry's own doubt is that loading differs *within* a family — a machine shrug's handles may be
supported where a barbell shrug's grip is not, and a bodyweight glute bridge does not load the quads
the way a loaded hip thrust does. If that turns out to matter, the correction is another
append/remove migration on the same seven rows. Nothing downstream stores a copy: `muscles` is read
in a **live subquery** by the volume tallies, so a change re-derives history rather than applying only
forward, and the device re-hydrates its mirror from `/api/workout-data` — **no APK needed**.

## Verified

- **Applied to the local DB and read back**: all seven rows now carry exactly their sibling's muscle
  set, checked row by row rather than by row count.
- **Idempotence proved, not asserted**: the migration was applied **twice more** against the
  already-migrated database and the seven rows were byte-identical before and after. Same shape as
  216 and 219 — each statement appends one assignment and skips when the row already names that
  muscle, compared case-insensitively because the catalogue carries a few Title Case values.
- `tsc --noEmit` clean · `pnpm check:rules` **Ran 58 of 58** · `check-migration-numbers` no
  collisions · `check-backlog-pointers` OK.
- Renumbered 225 → **224** before committing: 223 was the directory head, and leaving a gap would
  have made the pointer wrong for the next session.

## Also in this PR

**Q-304b is CLOSED, not parked** — the owner decided against recomputing the historical 1RM
estimates. The entry keeps why, because "leave it" is not free either: an inflated PR shows on the
badge and in the AI chat, and drives a too-heavy prescription **only** for an exercise carrying a PR
with no recent log (`resolveWorkingBasis` takes `lastNonDeload1rm` first). That is the accepted cost,
and it is written down rather than implied. Q-304's forward fix is unaffected — this decision is
about history only, and `set_logs` is untouched, so the recompute stays possible if LA-27's 76
style-edited rows are ever solved.

The backlog file ends the day at **11948 lines — exactly where it started**, and its size baseline
was ratcheted back down to match. Three raises earlier in the session were for entries being
*corrected*; completing LA-24 and closing Q-304b gave the lines back.

## Not exercised

The migration has not run against production — that happens on the Railway deploy. It applied cleanly
locally on top of all 223 prior migrations and CI's Migration Check runs it against a fresh database.
Nothing native, offline-first, safe-area or gesture-related is touched, so **no device smoke run is
owed**; the catalogue reaches the device through `/api/workout-data` on the next workout load.
