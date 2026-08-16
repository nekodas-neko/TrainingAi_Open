# 2026-08-07 — Full-app deep review (saving · caching · performance · logic)

**Branch:** `claude/app-review-prompt-lpazwx` · **Type:** review/planning, docs-only
**Base:** `main` @ `891ffc8` (v1.267.15)

## What this session was for

The owner asked for a prompt to drive an in-depth review of the whole app — every section and every
route — covering saving, caching, performance and logic, since the last comparable sweep
(2026-07-20) was roughly 400 commits ago. They then asked me to run it myself, present the findings
for approval, and only afterwards write them to the backlog. That is what happened, in that order.

## What shipped

Docs only. No behaviour changed.

- [`docs/reviews/2026-08-07-full-app-review-prompt.md`](../../reviews/2026-08-07-full-app-review-prompt.md)
  — the reusable review brief: coverage ledger method, eight lenses, rules of evidence, and the six
  traps that have each cost a previous session.
- [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — the
  review itself: coverage table for all 201 routes, findings in three tiers, dead-code ledger,
  score-calibration analysis, and every clean result.
- `docs/implementation-backlog.md` — **Q-117 … Q-138** added (22 entries); **Q-72, Q-73 and Q-107
  updated rather than duplicated**; next free Q number moved to 139.
- `projectOverview.md` — a review summary row, a row for the un-installed APK, and a correction
  banner on the existing hydration row.

## Method

Eight lenses run as parallel sweeps (write paths/offline sync · caching/invalidation ·
performance/render · domain logic/dates · route hygiene/security · UI/safe-area/theme · coverage
ledger), plus two production passes I ran directly: `error_events` over 30 days, and
`/api/admin/day-review` over **91 days** in four paged requests.

Two things about the method are worth keeping for next time:

- **The production reads went first, before any code was read**, and they changed what the lenses
  prioritised. The `error_events` signature list is what pointed at the hydration error, the
  `Failed query` cluster and the un-installed APK.
- **Every serious sweep claim was re-verified in source during synthesis** before it reached the
  owner. That caught one stale claim (see below) and produced two findings the sweeps missed.

## What was found

53 findings. The four that matter most:

1. **Q-73's root cause, reproduced without a device.** The home-screen React #418 error is
   `session-select-content.tsx:1063` — `toLocaleDateString` with no `timeZone`, so Railway (UTC) and
   the S25 (Brisbane) disagree for 42% of each day. The entry had been marked ⛔ blocked on a device
   capture for two sessions.
2. **The `Failed query` faults are one app-wide fault.** `getSyncDelta` fires 22 parallel queries at
   a `max: 10` pool; `/api/readiness-score` and `/api/body-battery` share the signature, so their
   "cause NOT diagnosed" row and Q-107 are the same issue. It stayed undiagnosed because
   `lib/observability.ts:9-10` discards `err.cause`, which is exactly where Drizzle puts the real
   Postgres error.
3. **Two of the four headline scores carry less information than they appear to.** Over 91 days the
   Activity Score is effectively a step counter (r=0.775; `strengthFreq`, its largest weight, is
   exactly 100 on 91/91 days), and the Sleep Score's compression traces to four saturated
   contributors. Readiness, on the same data, has healthy spread — which is what proves these are
   calibration problems and not data problems.
4. **A cross-user phase-set leak** (Q-129) and **an activity date key written in the device's
   timezone** (Q-123c). The second is persisted data, so it cannot be corrected after the fact.

## Corrections made to existing docs

- **`projectOverview.md` and Q-73 both claimed `/` mounts all five tabs at once**, so a mismatch in
  any tab surfaces on home. False — `tab-shell.tsx:57-61` mounts only the initial tab. That wrong
  premise is what produced two dead-end investigations, so both places now carry the correction.
- **A sweep re-reported SEC-H2** (that `app/api/oura/webhooks` echoes the HMAC signing key, from the
  2026-07-06 review). I checked: it returns `{success: true}` and carries a comment forbidding the
  echo. **SEC-H2 is fixed.** The claim was dropped rather than passed on — worth recording as the
  concrete case for why agent findings get re-verified before they are written down.
- CLAUDE.md's Key Files table points at `lib/1rm.ts`, which no longer exists (noted, not fixed).
- CLAUDE.md records migration collisions 081/087 only; **146 and 161 are also collided** (Q-134 area).

## Deliberately not done

- **Nothing was fixed**, including Q-73's one-line change. The owner was offered the option of
  shipping it separately and chose to queue everything; backlog-driven implementation says plan now,
  build later.
- **No device verification.** Q-118 (safe-area) and Q-119 (contrast) are the two findings whose
  magnitude genuinely depends on the device, and both say so.
- **The four quiet production tables were not diagnosed.** `supplement_logs`, `food_logs`,
  `step_live_windows` and `oura_accel_chunks` have all stopped receiving writes. Q-124 gives a
  plausible mechanism for the supplements case; the rest are recorded as an open owner question
  rather than guessed at, because "the owner stopped logging food" and "the write path broke" look
  identical from the database.

## Open on the owner

1. **Install the current APK.** Production errors prove v1.258.0's native STT was never installed, so
   voice logging is broken on the device now. Two sibling features have the same dependency, and 90
   rows in `projectOverview.md` carry a not-verified-on-device marker — one smoke run would clear a
   large batch.
2. **Two ⛔ score decisions**, Q-137 (Activity) and the Q-72 update (Sleep). Both change a number the
   owner reads daily, so the review deliberately does not pick an option.
3. **The four quiet tables** above.
