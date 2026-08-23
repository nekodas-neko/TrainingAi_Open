# Implementation Agent (B) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (B) 🚧`** — exactly, emoji included. That
> title is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread.

**Updated:** 2026-08-23 · **By:** the eighth Lane B run · **Next ID:** `LB-5`

## Now
Nothing in flight. Seven PRs merged 2026-08-23 (#296, #297, #300, #311, #313, #316, #320). Nothing
waits on the owner: LB-1's gate was answered (*"Yes put the controls where reccomended"*) and
shipped in v1.334.0.

## This run (2026-08-23, eighth) — each has a journal entry in `docs/overview/entries/2026-08-23-*`

- **Q-362b** (v1.333.2, #296) — day surfaces group by session **id**; its guard asserts on the
  **durations, not the card count** (two cards appeared before the fix too, both showing 82 min).
- **Q-421** (v1.333.3, #300) — a workout's kcal names its basis: `Est. HR kcal` / `Est. MET kcal`.
- **BF-4's Lane B half** (v1.333.4, #311) — scan photo bounded to 1024 px, **−86.6%**. **NOT shown
  to be the owner's slowdown**; #112 and the cold-start check stay open, and are Lane A's.
- **Q-326** (v1.333.5, #313) — deleting a meal type with entries offers the move, not a refusal.
- **LB-1** (v1.334.0, #316) — edit/delete for logged training, back on `/health/day`; four handlers
  now shared with `health-content.tsx` via `lib/hooks/use-day-entry-mutations.ts`.
  `day-overlay-sheet.tsx` deliberately **not** deleted — filed as **LB-3**.
- **Q-415/Q-417 + Q-323's render half** (v1.335.0, #320) — one calorie budget on both surfaces, from
  `budgetProvenance(...).total`. Q-417 proposed tracking which source last wrote; reading the budget
  from the payload was better — `activeEnergyKcalToday` then has no consumer, so the unsequenced
  optimistic paint was **deleted** rather than ordered. Found **LB-4** on the way.

## Next
`node scripts/next-item.js --lane B`, and **re-verify the premise first** — across the last two runs
**five of seven entries taken had a wrong premise**. The tool says what is startable, never whether
it is true. **BF-4 reads as top and its Lane B half is done** (the rest is Lane A's); **Q-326 and the
`calorie-budget-surface` batch are shipped**. Next is **Q-323's two remaining DISPLAY changes**; its
blocking order is satisfied now the number the bar fills toward is right. **Its item (1) names "the
macro ring" but describes "a full 360° split by macro" — that is HOME's donut, not the Nutrition
tab's `MacroRing`, which already sweeps a progress arc over a grey track.** **Claim the lane first**:
`barBands`/`barPosition` sit in `packages/shared` (Lane A by path) but are reached only from
`components/` (Lane B by the import trace, which is the authority). Then **Q-406 before Q-395** —
`food-row.tsx` is extracted first.

## Do not re-litigate
- **`lib/coach/**` is Lane A** — settled against the import trace, not the path list.
- **`floor(pct/10)` is the right RPE prefill** (Q-423, refuted on production data). Do not re-propose
  `round`; the review also records why that entry's own acceptance criterion picks the wrong mapping.
- **`DayOverlaySheet` is unreachable** — measured twice; do not fix bugs inside it. LB-1 took its
  edit/delete controls to `/health/day`; **LB-3** decides its remaining three and deletes the file.
- **`Q-354` is why a spec must tap, not click.** LB-1's first run read exactly like the new controls
  were wired to nothing — button found, `.click()` clean, no dialog; `el.click()` via `evaluate`
  opened it, which separated harness from product. `page.touchscreen.tap()` for anything inside a
  `[data-swipe-carousel]`.
- **The seeded user is missing only `date_of_birth`**; `height_cm` and `sex` are present. Still
  standing: `FactorBar` is not a colour-only violation; absent scores are handled correctly on
  all 14 surfaces; Q-309 is refuted as a user-facing bug while Q-354 (mouse clicks on Nutrition) is
  real and parked; `radiogroup` beat `group` + `aria-pressed`; `coach-content.tsx`'s `scrollIntoView`
  is correct; none of Q-359's twelve latent fetch-once sites is worth converting.

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
- **This clone is SHALLOW, and `git fetch origin main` RE-SHALLOWS it every time** — after a full
  `--unshallow`, one plain fetch puts `.git/shallow` back, `origin/main` reads as **one** commit, and
  the next merge dies with *"refusing to merge unrelated histories"*. Nothing is wrong with the repo.
  **`git fetch --unshallow origin` immediately before every merge**; `test -f .git/shallow` tells you
  in one line. Confirm against GitHub (`list_commits`) before believing the history is gone.
- **Check the actual date on resume** (`TZ=Australia/Brisbane date`) — this one resumed three days on.
- **The aged local seed bites `goal-invalidation.spec.ts`** — it needs **today's** `body_metrics`
  row to carry steps, and `order by date desc limit 1` is not "today" once the container has aged.
  It fails identically on clean `main`; top the row up rather than debugging the diff.
- **`get_check_runs` lags; attempting the merge is the reliable check.** The ratchets say whether
  YOUR branch grew the file (LA-16) — re-read them AFTER the final merge.
- **A `Gate:`/`Needs:` field written inline is ignored** — it must start its own bullet. Cost this lane
  twice; `check-backlog-pointers.js` now fails on it, and on an unknown `[domain]` tag.
- **A backgrounded `pnpm dev` dies with its task** — `setsid nohup pnpm dev > log 2>&1 &` survives;
  launch it as its own step, never chained after a `pkill`. `E2E_BASE_URL=http://localhost:3000`
  points Playwright at it, much faster than letting it start its own.
- **`pnpm check:rules` ran 52 of 52 on 2026-08-23.** Quote the count, never "pass".
- **`projectOverview.md` and this baton sit ON their ratchet baselines, and RAISING one costs you the
  merge race.** Every agent edits `doc-size-baseline.json` and the history log, so a raise conflicts
  on every parallel merge — #320 lost three races that way and only landed once the entries were
  trimmed to net-zero and both files dropped out of the diff. **Trim; do not raise.**
- **The sandbox serves the MET table as SYNTHETIC fixtures**, so any activity's energy estimate is
  **0** here and `activeKcal` cannot be exercised through a logged walk. `estSessionKcal` prefers its
  **HR** estimate (Keytel — pure arithmetic): seed a session plus a `workout_hr_stats` row with
  `avg_bpm` when a fixture needs a real earned figure.
- **Mutation-check every guard**, and check what a passing assertion would ACCEPT — that is why the
  Q-362b spec asserts on durations rather than card count.
