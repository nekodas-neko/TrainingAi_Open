# TN-34 — the stress deload override is unwired, and so is the notification nobody mentioned

**Lane A · branch `lane-a/tn34-unwire-stress-override`.** Owner-approved 2026-09-10 — *"yes lets do
all that."*

## What shipped

`ai-dynamic.ts`'s `stressOverride` was:

```ts
stressHighMinutes != null ? stressHighMinutes >= STRESS_HIGH_DAY_THRESHOLD_MIN : daySummary === 'very_stressful'
```

and is now `daySummary === 'very_stressful'` alone. Temperature and illness still override; the
frozen Cloud arm is untouched.

The derived arm recommended a deload on **83% of the owner's days** (15 of 18 recomputed, 7 of 10 on
stored values since the 2026-08-31 fix), off the number TN-33 measured as carrying no signal — 57%
night buckets, night systematically positive, a **+0.072** correlation with readiness over 18 days
with the two halves pointing opposite ways. A flag that fires four days in five carries no
information.

## The sibling surface was worse, and the entry did not mention it

`lib/health-alerts.ts:59` ran the **same condition on the same input**, and two things make it the
more damaging of the pair:

1. It fires a **push notification** — "High stress day" — so the owner was notified four days in five.
2. A fired stress alert sets `moreSpecificFired`, which **suppresses the readiness-low alert**. The
   signal-less flag was masking the real one.

Found by the sibling-surface rule rather than by the entry, which scopes itself to
`ai-dynamic.ts:219-225`. `stressCurrent` is kept on that path deliberately: TN-33 §8 measures strong
episode structure in the *series* (lag-1 **+0.637**, residual **+0.372** after removing day/night
means). It is the daily aggregate that carries none, not the instantaneous level.

## Verification

Four mutations, all caught; one deliberately-equivalent control, passed:

| mutation | result |
|---|---|
| Re-wire the deload override | caught |
| "Fix" the firing rate by raising the threshold to 600 instead | caught |
| Drop the `very_stressful` arm entirely | caught |
| Re-wire the notification's highMinutes arm | caught |
| *Control:* rewrite `stressTriggered`'s ternary as `&&` | passed |

The second one matters most. The entry warns that raising `STRESS_HIGH_DAY_THRESHOLD_MIN` would be
*"the fifth 'the threshold is right, the input is wrong' in this pillar"*, so the tests assert at
1000 minutes as well as 150 — this is unwired, not re-thresholded.

Full gate green — **Ran 75 of 75**, 923 files / 8,752 tests.

**Five tests pinned the old behaviour and were rewritten to pin the new one**, so a re-wire fails
loudly rather than silently restoring the 83%. One of them is worth describing, because deleting it
would have quietly lost coverage: `next-session-stress-day.test.ts` was a regression test for the
adapter reading `derivedRows[0]` — *yesterday* — so a stale prior-day spike tripped today's prompt.
**That subject is now unreachable through the recommendation**: `todayDerived` still selects today
correctly, but its only consumer is `stressHighMinutes`, which the engine now ignores. So both cases
are inverted rather than removed, a third asserts 1000 minutes, and the header says plainly not to
"restore" the old `today=high → true` assertion — doing so would not be fixing a day-selection, it
would be re-introducing the 83%.

## Failure surfaces NOT exercised — read this before trusting the dev run

`pnpm dev` was run against local Postgres with a real authenticated session and a seeded
`stress_high_minutes = 1000` day. `/api/next-session` returned 200 both before and after the change
— **but that is not a demonstration of the fix**, because the route's response does not expose
`deloadOrRestRecommended`, `deloadStrength` or `temperatureAlert` at all. The code path loads and
runs; the behaviour difference is not observable there. What proves the change is the unit tests and
the mutation pass.

Also not exercised: the notification path end to end (it needs Capacitor), Samsung WebView, and the
owner's real drifted data — every figure above is from TN-33/TN-34's production measurements, which
are **row-scoped to the owner** and so are his days, not a system-wide rate.

## What is NOT done

The **re-wire**. Options 2 and 3 in the entry both wait on TN-33's level-2 test; when the series is
validated, the threshold should be re-anchored to this user's own distribution — a percentile, not
the 120-minute constant. TN-34 stays queued with a `Keep:` for exactly that.
