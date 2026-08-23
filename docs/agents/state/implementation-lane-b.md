# Implementation Agent (B) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (B) 🚧`** — exactly, emoji included. The
> title is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread
> even with a perfect baton.

**Updated:** 2026-08-23 · **By:** the eighth Lane B run · **Next ID:** `LB-2` (`LB-1` is filed and
gated, see below)

## Now
Nothing in flight. Three PRs merged on 2026-08-23 (#296, #297, #300), all green.

## Waiting on the owner
**LB-1 — nothing in the app can edit or delete a logged workout, exercise or activity.** `Gate:
owner`, and it is the only Lane B item that needs a decision. The four controls that did this live in
`DayOverlaySheet`, which **nothing can open** — `dayOverlay` starts null and every setter is a
`prev => prev ? … : null` no-op or `null`. `/health/day`, where the calendar tap lands instead, has
no edit or delete controls at all. Three DELETE routes have no reachable caller. The entry carries
the inventory and a recommendation with two alternatives; do not build it before the owner picks one,
because the naive port deletes the wrong day's data (that screen swipes between days while the
handlers hold a captured date).

## This run (2026-08-23, eighth)

- **Q-362b** (v1.333.2, #296) — day surfaces group by session **id**. Its guard asserts on the
  **durations, not the card count**: two cards appeared before the fix too, both reading the later
  session's 82 min. [Journal](../../overview/entries/2026-08-23-day-surfaces-session-identity.md).
- **LB-1 filed, then rewritten** (#297) — see *Waiting on the owner*.
  [Journal](../../overview/entries/2026-08-23-day-edit-delete-unreachable.md).
- **Q-421** (v1.333.3, #300) — a workout's kcal reads `Est. HR kcal` / `Est. MET kcal`, and the done
  screen says "from heart rate" rather than naming an effort tier that did not produce the number.
  [Journal](../../overview/entries/2026-08-23-label-session-kcal-basis.md).
- **BF-4's Lane B half** (v1.333.4, #311) — the scan photo is bounded to 1024 px before upload,
  measured **−86.6%** (2,266,776 → 302,944 base64 chars). **It is NOT shown to be the owner's
  slowdown** — that entry already demoted the payload — and #112, the client-timing sink and the
  Railway cold-start check stay open and are Lane A's.
  [Journal](../../overview/entries/2026-08-23-bounded-scan-photo-payload.md).

## Next
Top-down with `node scripts/next-item.js --lane B`, and **re-verify the premise first** — across the
last two runs **five of the seven entries taken had a wrong premise**. The tool says what is
startable, never whether it is true.

**BF-4 still reads as top and its Lane B half is done** — what remains there is Lane A's, so skip to
**Q-326** (meal-type delete dialog), then **Q-323 / the `calorie-budget-surface` batch (Q-417 +
Q-415)**, three calorie budgets disagreeing across Home and Nutrition and still the largest coherent
piece of Lane B work. **Q-406 before Q-395** — `food-row.tsx` must be extracted first.

## Do not re-litigate
- **`lib/coach/**` is Lane A** — settled against the import trace, not the path list.
- **`floor(pct/10)` is the right RPE prefill** (Q-423, refuted on production data). Do not re-propose
  `round`; the review also records why that entry's own acceptance criterion picks the wrong mapping.
- **`DayOverlaySheet` is unreachable** — measured twice. Do not fix bugs inside it; two sessions have
  already done that, the second being this lane.
- **The seeded user is missing only `date_of_birth`** — `height_cm` and `sex` are both present.
- Still standing: `FactorBar` is not a colour-only violation; absent scores are handled correctly on
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
- **Q-421's MET card** (sandbox constant makes it 0, so only the HR label was ever rendered) and
  **BF-4's `getPhoto` bound** — a wrong field pair downscales silently never, which looks exactly
  like "the fix did not help".

## Claimed paths
None held. This run touched `scripts/check-backlog-pointers.js` (two new rules) and
`docs/doc-size-baseline*`; neither is a lane path and neither is held.

## Gotchas worth carrying
- **This clone is SHALLOW, and `git fetch origin main` RE-SHALLOWS it every time.** Not just on
  resume — measured 2026-08-23: after a full `--unshallow`, one plain `git fetch origin main` puts
  `.git/shallow` back and `origin/main` reads as **one** commit, so the next merge dies with
  *"refusing to merge unrelated histories"*. Nothing is wrong with the repo or with `main`.
  **`git fetch --unshallow origin` (or `--deepen=400`) immediately before every merge** is the
  working habit; `test -f .git/shallow` tells you in one line. Cost two merges in one session, and
  the second time it read as a repo disaster because `main` genuinely had a single root commit
  locally. Confirm against GitHub (`list_commits`) before believing the history is gone.
- **Check the actual date on resume** — this session resumed three days on. `TZ=Australia/Brisbane date`.
- **The aged local seed still bites, and its recorded reason is only half of it.**
  `goal-invalidation.spec.ts` needs **today's** `body_metrics` row to carry steps. Reading
  `order by date desc limit 1` is not "today" once the container has aged — confirm the date matches.
  It fails identically on clean `main`; top the row up rather than debugging the diff.
- **`get_check_runs` lags; attempting the merge is the reliable check.**
- **The ratchets say whether YOUR branch grew the file** (LA-16) — but re-read it AFTER the final
  merge; the attribution is only as current as the base it was computed from.
- **A `Gate:`/`Needs:` field written inline is ignored** — it must start its own bullet. Cost this
  lane twice; `check-backlog-pointers.js` now fails on it, as it does on an unknown `[domain]` tag.
- **A backgrounded `pnpm dev` dies with its task** — `setsid nohup pnpm dev > log 2>&1 &` survives;
  launch it as its own step, never chained after a `pkill`.
- **`E2E_BASE_URL=http://localhost:3000`** points Playwright at a running dev server — much faster
  than letting it start its own for a one-off probe.
- **`pnpm check:rules` ran 51 of 51 on 2026-08-23.** Quote the count, never "pass".
- **Mutation-check every guard**, and check what a passing assertion would ACCEPT — that is why the
  Q-362b spec asserts on durations rather than card count.
