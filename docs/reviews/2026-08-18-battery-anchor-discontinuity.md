# The Body Battery anchor flip is worth 17.7 points, and the sleep recalibration removed 82% of it

**Date:** 2026-08-18 · **Agent:** Tuning · **Type:** calibration evidence, docs-only
**Filed as:** Q-511 · **Lane:** A implements (this proposes only)
**Why this was checked:** the standing rule is that **every threshold or consumer on a display scale
must be re-anchored when that scale moves.** The sleep recalibration (v1.319.0) moved the sleep scale
by ~15 points. `LOW_SLEEP_SCORE` was re-anchored in that PR; this is the audit of whether anything
else on that scale was missed.

**Result: nothing was missed, and one consumer was silently improved.** That improvement is worth
recording precisely, because the obvious "fix" later — pushing sleep scores back up — would undo it.

---

## 1. The audit: what else consumes the sleep score

Every non-test consumer of `sleepScore` in the tree:

| consumer | how it uses it | affected by the scale change? |
|---|---|---|
| `rest-day-guidance.ts` | `sleepScore < LOW_SLEEP_SCORE` | **yes — re-anchored in the same PR** (60 → 42) |
| `body-battery/anchor.ts` | **the anchor value itself**, clamped 0–100 | **yes — §2 below** |
| `readiness-payload.ts` | `previousNight` contributor, passthrough | yes, and already quantified (~1.8 pts) |
| `stress-resilience.ts` | feeds `sr` → `dailySleepRecovery` | yes, already filed as Q-508 |
| trends / timeline / cards | display only | no threshold |

**There is exactly one comparison threshold on the sleep scale in the whole codebase**, and it was
re-anchored. The remaining consumers take the score as a value, so they inherit the shift directly
rather than needing a constant moved.

---

## 2. Body Battery's anchor takes the sleep score raw — and can swap it mid-morning

`resolveAnchor` has no thresholds: `ownSleepScore` becomes the day's anchor, clamped to 0–100. Its
own docstring records why it freezes:

> *Recomputing this on every read let the source flip from `sleep` to `readiness` part-way through the
> morning, which shifted the ENTIRE day's curve by the difference between the two scores — the number
> visibly jumped and the two Home cards stopped agreeing (owner report, 2026-08-02).*

So the size of that jump is exactly `readiness − sleepScore`. It had never been measured.

### 2.1 Measured

Over the **33** days carrying both scores (`claude_ro.oura_daily_derived`):

| | value |
|---|---|
| mean sleep score (old model) | 87.2 |
| mean readiness score | 69.5 |
| **mean jump (`readiness − sleep`)** | **−17.7** |
| sd | 10.2 |
| range | **−51** … +6 |
| mean absolute jump | 18.1 |

A provisional sleep anchor upgrading to readiness moved the whole day's battery curve down by **17.7
points on average**, and on the worst day by **51**. That is the owner-reported bug, quantified.

### 2.2 What the recalibration did to it

The recalibration review measured the sleep-score shift over its 65-night replay: mean **84.1 → 69.5**,
a shift of **−14.6**. Applying that shift to the gap above:

```
gap before   −17.7
sleep shift  −14.6
gap after    ≈ −3.1     (82% of the systematic offset removed)
```

The two anchor sources were on scales **~18 points apart**; they are now roughly **3** apart. The
recalibration did not target Body Battery at all — it fell out of putting sleep on a realistic range,
because readiness was already on one.

**This is the part to protect.** If a future session reads the new sleep distribution as "too harsh"
and lifts it back toward the old mean, it re-opens an owner-reported bug in a different pillar. The
sleep scale and the readiness scale being comparable is now load-bearing for Body Battery.

### 2.3 What did NOT go away

The **systematic** offset is mostly gone; the **per-day disagreement** is not. The sd of 10.2 is
disagreement between two different scores about the same morning, and no recalibration removes that —
Q-276 is the open question of whether they should agree at all. So:

- The flip is still visible on an individual day (a 10-point sd means ±10-point jumps remain routine).
- **The freeze-once design stays load-bearing** and must not be relaxed on the grounds that the
  scores now "agree". They agree on average, which is not the same thing.

### 2.4 How often it fires is NOT observable, and this bounds the finding

`claude_ro.body_battery_daily` has **never persisted `anchor_source = 'sleep'`**:

| anchor_source | days | mean anchor | window |
|---|---|---|---|
| `readiness` | 41 | 70.1 | 2026-06-30 → 08-18 |
| `default` | 9 | 50.0 | 2026-07-08 → 07-16 |
| `sleep` | **0** | — | — |

A sleep anchor is *provisional* and is overwritten the moment readiness arrives, so the end-of-day
table cannot distinguish "the flip happened every day" from "readiness was always available first and
the sleep arm never ran". **The magnitude above is solid; the frequency is unknown.** The owner's
2026-08-02 report proves it fires at least sometimes.

Measuring the rate needs instrumentation — recording the provisional anchor and its source when it is
first written, not only the final one.

### 2.5 A separate observation: nine days anchored at a flat 50

Nine days (2026-07-08 → 07-16, immediately after the BLE re-key) carry `anchor_source = 'default'`
with an anchor of exactly 50 — neither a readiness nor a sleep score existed, so Body Battery started
every one of those days at a fixed midpoint regardless of actual recovery. The last such day was over
a month ago, so this looks like a post-re-key coverage gap that closed on its own rather than a live
defect. Recorded rather than filed, per *"something that stopped is not something that was fixed"*.

---

## 2.6 The symmetric audit: thresholds on the READINESS scale

Q-500 moved the readiness scale too (+1 on two-thirds of days), and its review enumerated six
thresholds and measured the crossings. Re-running that enumeration found it listed **six of eight**:

| threshold | site | in Q-500's table? |
|---|---|---|
| `< 45` (+ ACWR > 1.2) → early deload | `readiness-payload.ts` | yes |
| `50` → band Low/Moderate | `scoreBand()` | yes |
| `< 60` → AI `lowReadiness` branch | `ai-dynamic.ts:231` | yes |
| `< 60` → rest-day guidance | `rest-day-guidance.ts` | yes |
| `70` → band Moderate/High | `scoreBand()` | yes |
| `>= 75` → rest-day guidance "train hard" | `rest-day-guidance.ts` | yes |
| `< 60` → lowers the high-OTS threshold ×0.9 | `lib/oura-models/inference/ots.ts:151` | **no** |
| `< 40` → LLM `rest_day_recommended` instruction | `ai-periodization/prompt.ts:168` | **no** |

**The conclusion is unaffected, and that was checked rather than assumed.** `ots.ts` sits on the
**same 60 line** the review already measured as uncrossed. The prompt's 40 is a line the review never
measured — `external_readiness` is our own score (`liveReadinessForDay`) — but the only readiness
values anywhere in 35–48 across all of production are **37, 48 and 48**, so a uniform +1 shift moves
nothing across 40 (or 45). Q-500's table was incomplete; its answer was right.

Q-500's review has been amended in place with both rows and a note, rather than leaving an incomplete
enumeration for the next person to inherit. **A threshold living inside an LLM prompt string is the
one this class of audit will keep missing** — it is invisible to a grep for numeric comparisons
against a score variable.

---

## 3. Proposal

1. **Change nothing in the scoring.** The audit's finding is that the re-anchoring was complete and a
   second consumer improved. There is no constant to move.
2. **Record the scale-comparability constraint** so it is not undone: `docs/domains/body/` and the
   Body Battery entries should note that the sleep and readiness scales being within a few points of
   each other is what keeps the anchor flip small.
3. **Instrument the provisional anchor** (§2.4) if the flip is ever reported again — one extra column
   or log line turns an unmeasurable rate into a measurable one. Low priority while no one is
   reporting it.
4. **Do not relax the freeze-once rule** (§2.3).

---

## 4. What was not exercised

- **No code changed and nothing ran on-device.**
- **§2.2 mixes two windows.** The gap (−17.7) is measured over 33 production days; the sleep shift
  (−14.6) comes from the recalibration review's 65-night replay. The old-sleep means differ between
  them (87.2 vs 84.1), which is ordinary subset variation but means **−3.1 is an estimate, not a
  measurement**. The robust claim is "most of the systematic offset is removed", not the exact figure.
  It cannot be measured directly until enough new-model rows accumulate — currently there is **one**.
- **The flip rate is unknown** (§2.4), so the *expected* daily impact cannot be stated — only the
  impact when it occurs.
- **Q-276 is not resolved or re-opened here.** Whether readiness and Body Battery should agree at all
  is a separate, owner-facing question.
- Every figure is **the owner's** (`claude_ro` is row-scoped), pulled 2026-08-18.
