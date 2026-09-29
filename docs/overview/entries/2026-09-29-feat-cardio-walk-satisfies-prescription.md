# RV-166 — a walk can finish the day's prescribed run, and the card says what counts

**Branch:** `feat/cardio-walk-satisfies-prescription` · **Version:** 1.482.0

In production, `prescribed_runs` held **26 rows: 0 completed, 0 with an `activity_log_id`** — no
prescribed run had ever been marked done, although 17 of the 22 pending days and 3 of the 4 skipped
ones had a walk, treadmill session or run logged on the day. The owner walks.

## The entry said the root cause was two lines. It was two lines and a dead end.

Both call sites in `done-activity-screen.tsx` did gate on `activityType === 'run' && prescribedRunId`,
and dropping the type half is correct. But **removing it alone changes nothing**, because the only
writer of `prescribedRunId` is `running-plan-content.tsx`'s `onStart`, which calls
`startActivity('run', …)` first. The id is never set on a walk, so the second half of the guard was
already false. The missing piece was never the guard — it was that **there was no way to start a walk
from the prescription at all.**

## What shipped

- **`components/cardio/todays-cardio-card.tsx`** — the card the mockup approved on 2026-09-27
  ([`docs/design/2026-09-27-four-screen-mockups.html`](../../design/2026-09-27-four-screen-mockups.html),
  sections RV-166 and RV-166b), above the modality picker and never instead of it. It states the
  criterion in zone terms with live progress, and `Walk it` opens the two routes.
- **`components/cardio/todays-cardio-copy.ts`** — the wording and the arithmetic, pure and tested:
  the zone label, the criterion, the status, and `countedProgress`.
- **`lib/activity/link-prescribed-run.ts`** — extracted from the done screen, because two save paths
  now complete a prescription and a second copy is a walk that counts on one screen and not the
  other. `completedAs` is a **required** parameter: the server writes null on any status change that
  does not say otherwise, and `completedAsRun()` reads null as a run, so a silent walk would switch
  off the next quality session and put walking pace into easy-run stats (LB-179).
- **`lib/stores/activity-store.ts`** — `logCompletedActivity`, which arms a session as already
  finished so the treadmill route lands on the existing done screen with the minutes filled in.

## The decision worth recording: no third writer

The mockup's *"treadmill walk — just log it"* has no existing home. There is no manual duration-log
path in the app: `LogActivitySheet` is a type picker that starts the live timer, and the guided walk
builds an **interval** plan, so routing plain minutes through it would fabricate an interval walk and
title it one. A new writer was the obvious third option and is the one the rules forbid — the
offline-first local-store + outbox contract is already written twice, and a third copy is the
"my data disappeared" bug class.

So the treadmill route **arms the session as finished and reuses the one writer**: `Walk it` → a
duration chip → the done screen, prefilled, with Save. Three taps rather than two, and the owner sees
what is about to be logged. `done-activity-screen` remains the only place a walk's activity log is
written.

## Stored numbers do not move

The entry warned that this changes what counts as a completed session, so adherence, streaks and
compliance shift. **That applies to a backfill, and there is no backfill here.** The 20 past days
with a walk logged stay `pending`; only walks completed from the card going forward link. Backfilling
them is a separate decision under the history policy and is deliberately not taken.

## Verified

- `e2e/rv166-todays-cardio-card.spec.ts` — **3 tests, all passing** at the 412 px dark viewport
  against the real component, with the prescription injected (the seed user has no running plan, so
  every assertion would otherwise pass vacuously against the very empty hub this change fixes).
  All three failed on the first run, on locator ambiguity with the hub's own "Guided walk" button and
  its "What do you want to do?" heading — which is what made the card a labelled landmark.
- The source guard in `rv166-todays-cardio.test.ts` was **proved able to fail**: run against
  `origin/main`'s copy of the done screen it matches the forbidden guard and finds 3 link calls with
  no `completedAs`.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **952 files, 9,496 passed** · `pnpm build`.
- `check-zero-arg-mock-indexed` caught a genuine TS2493 in the new test — the Build job would have
  found it after the merge.

## Not exercised

- **The completion itself, end to end.** `getLocalStore` returns null in the browser, so the local
  write, the outbox mutation and the pull-back never run here. The payload contract is unit-tested
  (`rv166-link-prescribed-run.test.ts`, 5 tests) and the **device pass is owed** — the entry keeps a
  `Keep:` line for it.
- **The estimated path on real data.** A treadmill walk with no heart rate counts from its logged
  minutes; the sandbox has no such row.
- **The device.** No native, safe-area or gesture change, but the card is new furniture on a screen
  the owner opens daily, and the Coach button overlaps content at the bottom of the hub the way
  BF-206 describes for Home.
