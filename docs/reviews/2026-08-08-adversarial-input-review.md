# Adversarial input, and a correction to my own Q-151 — 2026-08-08

_Domains: `activity`, `platform`, `app-shell`. The adversarial-value half of Step 1 of
[`2026-08-09-deep-review-prompt.md`](2026-08-09-deep-review-prompt.md), plus a retraction._

---

## 1. Q-151 was wrong, and the way it was wrong is instructive

I filed **Q-151** claiming `/sign-in` carried a second, still-live React #418 hydration mismatch, and
attributed part of production's 153-hit #418 series to it. **#1184 refuted it, correctly.** Its
evidence:

- **Zero of 272 production #418s are on `/sign-in`.** Every one is on an authenticated route — `/`
  (234), `/more` (15), `/health` (13), `/workout` (7).
- **The series stopped nineteen minutes after Q-73's deploy**, against a ~4/day fortnight baseline.
- **It does not reproduce** — eight runs across dev *and* a production `next build`, under four
  localStorage theme states chosen to trigger the inline theme script that mutates `<html>` before
  hydration.

**What I actually saw** was the dev-server console warning *"A tree hydrated but some attributes of
the server rendered HTML didn't match…"*. Two errors followed from it:

1. **I treated a dev-mode React warning as evidence of a production error.** React's dev build emits
   hydration diagnostics that the production build does not; the two are not interchangeable.
2. **I attributed a production count to a route without checking the `url` column** — while already
   querying that exact table. One `GROUP BY url` would have killed the claim before it was filed. That
   is the part I find least defensible: the disproof was one clause away in a query I had already
   written.

The lesson generalises past this instance: **"I saw an error on page X" and "production's error
counter for that class is high" are two claims, and joining them requires evidence, not adjacency.**
Recorded here rather than only in the backlog because the reasoning error is more reusable than the
retraction.

#1184 downgraded Q-151 to a dated watch item rather than deleting it, which is the right call under
*something that stopped is not something that was fixed*.

## 2. 🟠 A 69-day walk was accepted — 28 of 60 numeric validators have no upper bound

`POST /api/activity-logs` with `durationMin: 100000` returned **201 Created** and persisted. That is a
single walk lasting **69.4 days**. (Row deleted; local DB verified clean afterwards.)

`packages/shared/src/validation/activity-log.ts:37` reads:

```ts
durationMin: z.number().positive().optional(),
```

Positive, unbounded. `distanceKm`, `caloriesBurned`, `elevationGainM`, `avgPaceSecPerKm` and the HR
fields in the same file are equally open.

**What makes this a finding rather than a nitpick is that the codebase already solves it elsewhere.**
`packages/shared/src/validation/body-metrics.ts:95`:

```ts
weightKg: z.number().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX).nullish(),
```

Bounded, with **named constants**. Counted across the validation and validators directories:
**32 numeric validators carry `.max()`; 28 do not.** So this is inconsistent application of a pattern
the project has already designed well — not an oversight nobody thought of.

**Consequences:**

- Every aggregate summing these is corruptible by one typo — weekly activity totals, training load,
  calorie burn.
- `deriveEndTime` (`activity-log.ts:75-77`) adds `durationMin` to `startTime`, so an over-long
  duration yields an end timestamp days later and can push the activity into the wrong day bucket.
- **The plausible typo is more dangerous than the absurd one.** 100,000 is obvious in a chart; 1000
  instead of 100 silently inflates a week and nothing looks wrong.

Filed as **Q-164**, with a note that this is a strong CI-check candidate — "a `z.number()` in a
validation schema with no `.max()`" is mechanically detectable, and the shrink-only grandfather
pattern lets the 28 be burned down incrementally.

## 3. What correctly rejected — the other half of the result

Not everything was open. These were tried and properly refused:

| input | result |
|---|---|
| `durationMin: -30` | **400** |
| title: 500 chars of emoji + RTL Arabic | **400** |
| body-fat percentage out of range | bounded by schema |
| weight (0, 999, −50, `"abc"`) | bounded — `WEIGHT_KG_MIN/MAX` |

The gap is specifically the **upper** end of otherwise-validated numerics, which is a much narrower
and more fixable statement than "input validation is weak".

## 4. Contrast — a third attempt, and a definitive stop

Lens 10 recorded contrast as unmeasured after two failed methods. A third attempt was made, this time
**starting with a self-test**: render black text on a white background and confirm the method returns
~21:1 before trusting it on real screens.

**It returned 1.96:1.** The method is broken in a case whose answer is known, so no measurement taken
with it — including the ten discarded numbers from Lens 10 — should be believed.

Two useful things fell out anyway:

- The self-test immediately caught a `clip` key-name bug (`w`/`h` vs `width`/`height`) that silently
  produced garbage in attempt 2 — plausibly the whole cause of that attempt's uniform 1:1 results.
- **The next attempt now has a known-good target to iterate against** rather than guessing at real
  screens where nobody knows the right answer.

Contrast remains **unmeasured**, and `DetailHero`'s hardcoded-dark case remains unverified. Three
attempts is enough for one session; the self-test harness is the deliverable.

## 5. Boundary dates — clean across every route tried, leap years included

Twelve date values against four date-accepting GET routes (`day-log`, `day-timeline`, `oura/hr-day`,
`workout-sessions/day`). **Zero 500s.** This is the class CLAUDE.md has been burned by repeatedly
(`RangeError: Invalid time value` from a raw param reaching `aestMidnight`), so the result is worth
stating precisely:

| input | result | why it is the right answer |
|---|---|---|
| `2026-02-30` | 400 | day does not exist |
| `2026-02-29` | 400 | **2026 is not a leap year** |
| `2024-02-29` | 200 | **2024 is** |
| `2026-13-01`, `2026-00-10` | 400 | month out of range |
| `2026/08/08` | 200 | the `[-/]` regex accepts `localDateString()`'s slashes |
| `20260808`, `2026-08-08T00:00:00Z`, `null` | 400 | malformed |
| `2026-12-31`, `2027-01-01` | 200 | year boundary |

The leap-year pair is the strongest signal — that is real calendar validation, not a regex that
happens to look right. Q-130's date-hardening work holds under adversarial input.

## 6. Concurrent duplicate submits — server accepts them, client correctly prevents them

Five identical concurrent `POST /api/activity-logs` → **five 201s and five rows.** The server has no
idempotency key.

**This is not a live bug, and it would have been a false positive to file it as one.** CLAUDE.md's
stated mitigation for this class ("5 rapid taps once fired 4 `complete-workout` POSTs", session 86) is
a **client-side in-flight guard**, and the real save paths have one:

- `components/activity/done-activity-screen.tsx:65,423,431` — `saving` state, both buttons
  `disabled={saving}`
- `components/guided-walk/walk-summary.tsx:55,112-113` — a `savedRef` ref guard, which is the stronger
  form because it cannot be raced by a render.

My test fired at the API directly and bypassed the UI entirely. Recorded as **checked and mitigated**,
with the nuance that server-side idempotency genuinely is absent — which matters only for a future
non-UI caller, since outbox retries dedup on the stable mutation id.

## 7. Not covered

Offline write behaviour was **not** reached. `/api/body-metrics` has no POST handler (404 on every
attempt), so the weight-bounds check above comes from reading the schema, not from exercising the live
write path.

No device, no APK, no native SQLite.
