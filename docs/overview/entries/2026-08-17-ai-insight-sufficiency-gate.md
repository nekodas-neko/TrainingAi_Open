# 2026-08-17 — Q-452: the AI insight card commenting on data that does not exist

**Branch:** `claude/implementation-lane-b-0o7kb9` · **Version:** v1.318.6 · **Lane:** Implementation B

## What was wrong

`AiInsightCard` fired `POST /api/ai/health-insight` on every mount, unconditionally. The route
builds its prompt by substituting the literal string `"no data"` for every absent field — ten of
them across the four sections — and calls `generateText` regardless.

Handed `Steps: no data`, the model does not report absence. It asserts **zero** and then
editorialises. A zero-data account on its first ever visit to `/health/activity` was told:

> Your activity tracker currently shows **zero movement and no strength sessions** toward your goal
> of five per week. **This inactivity creates a significant gap** in your ph…

Re-verified against `main` before building: the unconditional fetch, the card's data-free props and
all ten `"no data"` substitutions were exactly as filed.

## What shipped, and what deliberately did not

`AiInsightCard` now takes a **required** `hasData: boolean` — required rather than defaulted, so a
new call site has to answer the question — and neither fetches nor renders without it. Gating in the
client rather than returning `{ insight: null }` from the route costs no request at all, where the
server-side version would still pay one.

Two call sites:

| Call site | Gate |
|---|---|
| `health-score-detail.tsx` (readiness · sleep · activity) | `score != null` |
| `app/health/heart-rate/page.tsx` | the trend series carries any `rhrBpm` or `hrvMs` |

**This is half the fix, and the half that is not mine.** The prompt is what conflates absent with
zero, and it lives in `app/api/**` — Lane A. A section that *has* a score but is missing a field
still hands the model a `"no data"` line, which is the common case for anyone without a ring rather
than an edge case. Filed as **Q-353** with the fix shape.

## A claim in the first draft of this entry was wrong — corrected 2026-08-17

The original version of this entry said the heart-rate gate had to avoid `data.hrMin`/`data.recentHrv`
because those are "live-ring-only and therefore null for an account with months of recorded resting
HR", and cited a measurement showing the card hidden from the seeded user.

**That is not true.** Re-measured directly against `/api/readiness-score` for the seeded user:

```
hrMin: null   hrCurrent: null   recentHrv: 65   baselineHrv: 65
```

`recentHrv` is populated, so `hrMin != null || recentHrv != null` is **true** and that gate would
have worked. The earlier `card=0` observation was a **cold-compile timing artifact** — the probe
waited 6 s, and `/api/readiness-score` had not resolved yet on a first visit, so `data` was still
null. Confirmed by mutation: putting the old gate back and running the seeded-user spec with a 30 s
budget **passes**.

The shipped code is unchanged, because the trend-series gate is still the better choice — it mirrors
what the *prompt* actually reads (`body_metrics.restingHeartRate` / `hrvMs`) rather than a different
API's fields that happen to correlate. But it was chosen for that reason, **not** because the
alternative was broken, and the earlier entry asserted a measurement that does not hold.

The real lesson is the one worth keeping: **a 6-second wait is not a measurement on a cold dev
server.** Two of this repo's own rules already say so — `SKELETON_TIMEOUT_MS` is 20 s and
`goal-round-trip.spec.ts` documents a 39.7 s cold run against a 7.6 s warm one — and I walked into it
anyway.

## Verified, not guarded

Measured in a browser against two accounts — the seeded user and a temporary zero-data user, both
removed afterwards. Both directions matter and both were checked: the fix must hide the card when
there is nothing, **and** must not hide it when there is. The second is where the bug was.

No committed spec covers it, for the same reason as Q-451: the harness has one seeded account and it
has data. **Q-352** is the fixture that would close this, and it now has two dependants.

## What was NOT exercised

- **The device.** Web build only.
- **The partial-data case.** Not reproducible without constructing an account that has one field and
  not another; it is the subject of Q-353 rather than of this change.
- **The `heart-rate` section's prompt behaviour** — the gate was verified, the copy the model
  produces for a partially-populated heart-rate section was not.
- **Samsung WebView rendering.** No layout changed (the card either renders as before or not at
  all), so there is nothing new to see, but it was not looked at.
