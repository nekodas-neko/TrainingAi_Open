# Implementation Agent (B) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (B) 🚧`** — exactly, emoji included. That
> title is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread.

**Updated:** 2026-08-23 · **By:** the eighth Lane B run · **Next ID:** `LB-5`

## Now
Nothing in flight. Eight PRs merged 2026-08-23 (#296, #297, #300, #311, #313, #316, #320, +Q-323). Nothing
waits on the owner: LB-1's gate was answered (*"Yes put the controls where reccomended"*) and
shipped in v1.334.0.

## This run (2026-08-23, eighth) — each has a journal entry in `docs/overview/entries/2026-08-23-*`

- **Q-362b** (#296) — day surfaces group by session **id**; its guard asserts on the **durations,
  not the card count** (two cards appeared before the fix, both showing 82 min).
- **Q-421** (#300) — a workout's kcal names its basis: `Est. HR kcal` / `Est. MET kcal`.
- **BF-4's Lane B half** (#311) — scan photo bounded to 1024 px, **−86.6%**. **NOT shown to be the
  owner's slowdown**; #112 and the cold-start check stay open, and are Lane A's.
- **Q-326** (#313) — deleting a meal type with entries offers the move, not a refusal.
- **LB-1** (#316) — edit/delete for logged training, back on `/health/day`; four handlers shared via
  `use-day-entry-mutations.ts`. `day-overlay-sheet.tsx` deliberately **not** deleted — **LB-3**.
- **Q-415/Q-417** (#320) — one calorie budget, from `budgetProvenance(...).total`. Q-417 proposed
  tracking which source last wrote; reading the budget from the payload was better —
  `activeEnergyKcalToday` then has no consumer, so the racing optimistic paint was **deleted**
  rather than ordered. Found **LB-4** on the way.
- **Q-323's display half** (#326) — the bar fills toward a goal notch, not a centred gauge; Home's
  donut became a progress ring. Its item (1) said "the macro ring" but described **Home's** donut.
- **Q-387's Lane B half** (#330) — "I've finished logging" + Undo + the N-of-10 counter, so the
  calibration can engage at all. **Q-359 closed out with it.**
- **Q-406** (#331) — `FoodRow`; library sheet and DB search converted, the diary row and the
  external-search row **not** (converting the diary row before Q-395a's sheet exists would delete
  the only way to correct a logged food).
- **Q-418's screen half** (#332) — HR, steps and elevation on the free walk; the guided walk got the
  step readout too (Q-410's half). The pill stays Lane A.

## Next
`node scripts/next-item.js --lane B`, and **re-verify the premise first** — **seven of thirteen
entries taken this run had a wrong premise**. The tool says what is startable, never whether it is
true. BF-4 reads as top and its Lane B half is done (the rest is Lane A's).

**⛔ BLOCKED, and it is the biggest contiguous chunk of the queue: Q-395's drawings are not in the
repository.** `unit-options.png`, which Q-395a names as its reference, is nowhere in the tree —
`docs/design/` holds cardio, score-row and AI-coach mockups and nothing for nutrition. **Do not take
Q-395a/b/c**, and do not convert Q-406's last two call sites, until they are committed under
`docs/design/`; otherwise the phases get built from prose with no way to check the visual match.
Raised with the owner 2026-08-23.

Non-blocked candidates: **Q-327** (meal photo picker), **Q-398** (meal plan → saved meals),
**Q-409** (recipe URL import — read its security notes first). LB-3 sits low, as its own placement says.

## Do not re-litigate
- **`lib/coach/**` is Lane A** — settled against the import trace, not the path list.
- **`floor(pct/10)` is the right RPE prefill** (Q-423, refuted on production data). Do not re-propose
  `round`; the review also records why that entry's own acceptance criterion picks the wrong mapping.
- **`DayOverlaySheet` is unreachable** — measured twice; do not fix bugs inside it. **LB-3** decides
  its remaining three affordances and deletes the file.
- **Q-354: a spec must TAP, not click**, and **`toBeVisible()` does not mean in-viewport**. Both read
  exactly like a dead control. `scrollIntoViewIfNeeded()` then `page.touchscreen.tap()` for anything
  inside a `[data-swipe-carousel]`.
- **Seeded user missing only `date_of_birth`.** Still standing: `FactorBar` is not colour-only;
  absent scores are handled on all 14 surfaces; Q-309 refuted as a user-facing bug, Q-354 real and
  parked; `radiogroup` beat `group`+`aria-pressed`; `coach-content.tsx`'s `scrollIntoView` is right.

## Owed (device / physical)
- A **test print** of the meal label, black band first (Q-389) — 0.49–0.66 mm per module.
- The meal-label **camera scan**, the Web Share hand-off, and the two new fonts (Q-389).
- A **TalkBack pass** over More → Goals and More → Edit Profile (Q-261, Q-350).
- Home with the **"Accent ring"** style (Q-281) — the band word is 7.5 px.
- A **drain run** confirming `/admin/oura-ble` holds still while the log streams (Q-532).
- **Q-450's device path** — the E2E run took the web fallback, not SQLite + outbox.
- **Q-421's MET card** (sandbox constant makes it 0, so only the HR label rendered), **BF-4's
  `getPhoto` bound** (a wrong field pair downscales silently never, which looks exactly like "the fix
  did not help"), and **Q-326's reassign dialog**.
- **LB-1's four controls** — 48dp targets and the dialogs' safe-area clearance, plus the local-store
  mirroring in all four handlers, which never runs on web. **#320's two cards** for the same reason.

## Claimed paths
None held. This run touched `scripts/check-backlog-pointers.js` and `app/health/day/page.tsx` (a
`userId` prop); neither is a lane path.

## Gotchas worth carrying
- **This clone is SHALLOW and `git fetch origin main` RE-SHALLOWS it** — `origin/main` then reads as
  **one** commit and the merge dies with *"refusing to merge unrelated histories"*. Nothing is wrong
  with the repo. `git fetch --unshallow origin` before every merge; `test -f .git/shallow` checks it.
- **Check the actual date on resume** (`TZ=Australia/Brisbane date`).
- **The aged local seed bites `goal-invalidation.spec.ts`** — it needs **today's** `body_metrics` row
  to carry steps, and `order by date desc limit 1` is not "today" once the container has aged. It
  fails identically on clean `main`; top the row up rather than debugging the diff.
- **`get_check_runs` lags; attempting the merge is the reliable check.**
- **A `Gate:`/`Needs:` field written inline is ignored** — it must start its own bullet. Cost this lane
  twice; `check-backlog-pointers.js` now fails on it, and on an unknown `[domain]` tag.
- **A backgrounded `pnpm dev` dies with its task** — `setsid nohup pnpm dev > log 2>&1 &` survives,
  as its own step. `E2E_BASE_URL=http://localhost:3000` points Playwright at it.
- **`pnpm check:rules` ran 52 of 52 on 2026-08-23.** Quote the count, never "pass".
- **Two Lane A paths edited and released**: `calorie-balance.ts` (Q-323's `barProgress`, reached only
  from `components/`) and one line in `lib/cache-groups.ts` registering `day-checkin:` (Q-387).
- **`projectOverview.md` and this baton sit ON their ratchet baselines, and RAISING one costs you the
  merge race** — every agent edits `doc-size-baseline.json` and its history log, so a raise conflicts
  on every parallel merge. #320 lost three races that way. **Trim; do not raise.**
- **On a doc conflict, ask whether the two sides are the SAME entry rewritten or two independent
  ones.** "Keep both" is right for independent entries and duplicated Q-406 when it was not.
- **The sandbox serves the MET table as SYNTHETIC fixtures**, so any activity's energy estimate is
  **0** here and `activeKcal` cannot be exercised through a logged walk. `estSessionKcal` prefers its
  **HR** estimate (Keytel — pure arithmetic): seed a session plus a `workout_hr_stats` row with
  `avg_bpm` when a fixture needs a real earned figure.
- **Mutation-check every guard**, and check what a passing assertion would ACCEPT — that is why the
  Q-362b spec asserts on durations rather than card count.
