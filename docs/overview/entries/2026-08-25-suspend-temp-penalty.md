# The temperature penalty is suspended until its baseline is centred (TN-6a)

**Branch:** `fix/suspend-temp-penalty` · **Lane A** · no migration · user-visible

## Why now, and why on its own

`computeBlendedScore`'s absolute-°C ladder penalises readiness at |dev| > 0.3 / 0.5 / 1.0. That only
works if the deviation is centred on zero. BF-13's zero-seeded baseline sat **0.363 °C low**, so the
deviation was positive on **34 of 34 nights**, the ladder fired on **91.2%** of them, and being
healthy cost **−16.3 readiness points a day**.

The seed fix shipped hours ago, but the owner's *stored* baselines are still the zero-folded ones
until a Redecode re-derivation runs. The entry is explicit that this lands first and alone.

## Self-clearing, which is the whole design

`isTemperatureBaselineCentred` suspends the ladder while the trailing mean deviation sits outside
**±0.15 °C**, or while there are fewer than **10** nights of readings to judge by. It re-evaluates on
every request against the 28-day summary window the payload already loads — no extra query — so the
moment a Redecode centres the stored deviations the ladder returns **with no deploy**.

That is the entry's own argument: a `TODO: remove after` can be forgotten, a computed condition
cannot. It is also what makes it safe to ship ahead of the re-derivation.

**Too little history suspends.** Absence of evidence is not evidence of centredness, and it costs
nothing — a baseline that young was never trustworthy through this ladder.

**The mean is the entire test.** The entry offered a fraction-negative check as an alternative; it is
deliberately not ANDed in. A mean inside ±0.15 °C already implies both sides are represented, and a
second condition would make the suspension harder to clear without measuring anything new.

**The thresholds are untouched.** Widening them would hide a broken input behind a plausible firing
rate and permanently desensitise a real fever once the baseline converges — the answer TN-6, Q-506
and BF-13 all give.

## What it costs, stated plainly

Fever detection through this one path, until TN-6 replaces the ladder. Near zero while the condition
holds: a deviation positive on every single night cannot distinguish illness from baseline error in
either direction. The owner was told this before choosing.

## Verification

Eleven tests, **both halves mutation-verified**: ignoring the suspension fails five cases, dropping
the min-nights guard fails one.

- The suspension is exercised against the **owner's real 34-night shape** (mean +0.662 °C, every
  night positive), and clearing is proven on that same history shifted to centre — the entry asked
  for both fed through, "not by reading the condition".
- One test pins that **only** the temperature arm is suspended: ACWR still moves the score, and a
  below-threshold deviation is unchanged in both states.
- `pnpm check:rules` — Ran 56 of 56. `tsc --noEmit` clean, `pnpm lint` 0 errors.
- Full suite: **4776 passed, 51 skipped, 0 failures.**

**One unexplained flake, recorded rather than dismissed.** An earlier full run showed 2 failures in
`claude-ro-owner-bootstrap.test.ts`. It passes alone, passed on the immediate re-run, and my diff
touches nothing near it — it matches the DB-contention class CLAUDE.md documents. Noted because
"it went away" is not the same as "it was explained".

## Not exercised

Nothing on device, and **nothing observed in production**: the suspension is proven against the
owner's measured deviation values, not against a live readiness response.

**This is a suppression, not a fix.** It must be retired by TN-6 rather than left as permanent
behaviour — TN-6's own pass test (deviation mean within ±0.05 °C of zero) is what retires it, and
until then the ladder is off for anyone whose baseline is uncentred.
