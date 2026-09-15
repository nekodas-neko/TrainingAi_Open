# 2026-09-15 — RV-38: the guard that got weaker as the data got worse

**Branch:** `fix/rv38-body-battery-no-data-badge` · **Lane B**

Body Battery printed **Good / Steady / 50** for an account that has never worn anything.

## The route was honest; the card was not

`GET /api/body-battery` for the zero-data account says it has nothing **four separate ways**:

```json
{"current":50,"label":"Good","trend":"steady","hasData":false,
 "confidence":{"sampleCount":0,"samplesPerHour":0,"sufficient":false},
 "anchor":50,"anchorSource":"default"}
```

The card rendered a colour-coded label, a bar filled to 50%, and no qualification of any kind.

## Why it survived: the guard inverted at the worst case

```ts
const lowData = battery.hasData && conf != null && !conf.sufficient
```

- enough samples → no badge ✓
- too few samples → "Limited data" ✓
- **none at all → no badge** ✗

The qualification got *weaker* as the data got worse. Read once, the `hasData` term looks like
defensive care; what it actually does is exempt the one case where the warning is most true. Dropping
it is the entire fix — `sufficient` is already false in both cases that deserve the badge, which is
what makes it the right condition on its own.

## Two things checked rather than assumed

**The expanded copy needed no guard.** The *"your ring recorded only N heart-rate readings"*
paragraph sits inside the `battery.hasData ?` branch, so a zero-data account never reaches it. Had it
been outside, this fix would have told someone their ring recorded "only 0" readings.

**The stale comment was real.** Lines 134–139 claimed the explainer *"only renders in the NO-DATA
state, which means on any ordinary day nobody ever reads it"* — two lines below the Q-276 note saying
it is always visible, and directly above unconditional JSX. Deleted.

## What is deliberately not fixed

**The number.** The owner handed it to Tuning on 2026-09-14 — *"This requires tuning still"* — and a
Body Battery re-fit silently re-scores months of history, so it goes through a proposal that states
how many other days it moves. Nothing here touches it.

**Whether no-data deserves an `—` rather than a badge.** That is the owner's call, and
`/health/heart-rate` shows the stronger posture already exists in the app. Not asked and not
blocked on: the badge is strictly better than what shipped before and reverses in one line, so
shipping it does not foreclose the decision.

## Verification

The e2e runs as the zero-data account and **captures the response beside the rendered text**, which
the entry asked for specifically — a rendered 50 on its own cannot distinguish a bug from a fixture.
Against `main`'s unfixed card the badge is simply absent and the test fails on it.

## Not exercised

**No device pass.** Kept as RV-38's `Keep:` ③.
