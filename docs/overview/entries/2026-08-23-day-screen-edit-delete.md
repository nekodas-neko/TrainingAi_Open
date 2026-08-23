# 2026-08-23 — Edit and delete for logged training, back on the day screen (LB-1)

**Branch:** `feat/day-screen-edit-delete` · **Lane B** · v1.334.0

## What shipped

`/health/day` now carries the four controls that went missing with Q-110: edit and delete on every
exercise row, delete on every session card, delete on every activity. `day-overlay-dialogs.tsx` is
reused **unchanged**, so the edit sheet and both confirmations are the ones already written and
approved — this is a relocation of controls, not a redesign.

| file | change |
|---|---|
| `lib/hooks/use-day-entry-mutations.ts` | **new.** The four handlers plus their dialog state |
| `components/health/day-detail/day-sections.tsx` | `TrainingSection` / `ActivitySection` gained the controls — the file had **zero** interactive elements before |
| `app/health/day/day-detail-content.tsx` | wires the hook, renders `DayOverlayDialogs` |
| `app/health/day/page.tsx` | passes `userId` through, for the local-store mirroring |
| `app/health/health-content.tsx` | its own four handlers deleted; now calls the same hook |
| `e2e/day-entry-edit-delete.spec.ts` | **new.** Four cases |

## Decisions

**The controls went on `/health/day`, not back on the sheet** — the owner's call, from the three
options in the LB-1 entry. It is where the calendar tap already lands, and Q-110 moved there for
sleep, body composition, scores and the whole-day HR trace that the sheet does not show.

**One hook, two callers.** The obvious shape was to copy the handlers onto the day screen, which
would have left two copies of four write paths — exactly the drift the "one write function per
domain" rule exists to stop. `health-content.tsx` was moved onto the same hook in the same PR, which
also took ~150 lines out of a listed 800-line hotspot.

**The date is read at action time, from `dateRef`, not captured at render.** This was the reason the
entry was owner-gated: the screen swipes between days, and a handler holding a stale date on a
screen whose whole job is changing dates could refresh the wrong day. Two things make it safe — the
entities are addressed by `exerciseLogId` / `workoutSessionId` / activity `id`, never by date, so
*what* is written is never in doubt; and the refresh targets whatever day is on screen when the
dialog is confirmed, which is the one the user is looking at.

**The post-write refetch does not re-seed.** `load(date, { seed: false })` keeps the current paint
while the fresh payload lands. Seeding after the caches were just cleared would blank every section
for the length of the round trip — the instant-paint rule, applied to a mutation.

**`day-overlay-sheet.tsx` was NOT deleted.** It still owns three affordances the day screen has not
got (exercise-name tap → `ExerciseHistorySheet`, activity tap → `ActivityDetailSheet`, per-session
HR recovery expander), all unreachable since Q-110 as well. Deleting the file would have discarded
them silently; filed as **LB-3** instead.

## Gotcha worth keeping

`.click()` does not work on these screens under Playwright — it dispatches a mouse-only sequence
that never produces a `click` event, already measured and written up on
`water-log-write-path.spec.ts` (Q-354). The first run of the new spec read exactly like the controls
were wired to nothing: the button was found, clicked without error, and no dialog opened. A DOM
`el.click()` opened it, which is what separated a harness artifact from a product bug.
`page.touchscreen.tap()` is the path that works, and is how the product is actually used.

## Not verified

**Nothing ran on the S25.** The 48dp targets and the confirm dialogs' safe-area clearance were built
to the rule but the web sandbox renders insets as 0. The local-store mirroring inside all four
handlers also never executed — `getLocalStore` returns null on web — so the offline half of every
write is verified by reading only. Recorded as a Known-Issues row rather than struck.
