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

## The gotcha, which only showed up by running it

My first heart-rate gate was `data?.hrMin != null || data?.recentHrv != null`. Those are the fields
the page's own stat tiles and `HrFactorsCard` use, so they look exactly right.

They are wrong. `hrMin`/`hrCurrent`/`recentHrv` come from **live ring readings**, which an account
with months of recorded resting HR and no ring simply does not have. Measured against the seeded
user, who has `restingHeartRate` 58 and `hrvMs` 65 in `body_metrics`:

```
SEEDED /health/heart-rate -> card=0     ← my gate hid it from a user who has the data
SEEDED /health/readiness  -> card=1
SEEDED /health/sleep      -> card=1
SEEDED /health/activity   -> card=1
```

The gate has to mirror what the *prompt* reads, which is `body_metrics.restingHeartRate` and
`hrvMs`. The client-side view of exactly those two columns is the trend series (`rhrBpm` ←
`restingHeartRate`). After the correction:

```
SEEDED   /health/{heart-rate,readiness,sleep,activity} -> card=1  (all four)
ZERODATA /health/{heart-rate,readiness,sleep,activity} -> card=0  (all four)
```

Reading the code would not have caught this. The wrong field name is the plausible one.

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
