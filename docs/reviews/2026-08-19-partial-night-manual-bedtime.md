# A night the ring missed: manual bedtime, and why it must write exactly one column

**Date:** 2026-08-19 · **Agent:** Tuning · **Type:** design proposal from an owner report, docs-only
**Filed as:** Q-519 (manual bedtime) · Q-520 (partial-night flag) · **Lane:** A implements

**Owner report, 2026-08-19:** *"I forgot to put the ring on last night before bed. I put it on when I
woke up to pee at 4am… I don't want it to change estimated bed time values."*

The recorded session reads **4:23 am – 8:03 am, 3h 5m asleep, 84% efficiency, 30m latency, 1 restless
period**, against trailing averages of 8h and 92%.

---

## 1. The night holds two kinds of data with opposite validity

This is the whole design, and getting it wrong in either direction is the failure mode.

| measures *when the ring was on* — **wrong** | measures *the body during the observed window* — **right** |
|---|---|
| time asleep 3h 5m | HRV 61 ms |
| efficiency 84% | lowest HR 53 bpm |
| latency 30m | avg HR 57 bpm |
| bedtime 4:23 am | breathing 9.1 br/m |
| restless periods 1 | |

The physiology is not merely present, it looks **correct**: HRV 61 against a 59 ms trailing average,
and a lowest HR of 53 which is *exactly* the trailing average. Those are real measurements of real
sleep.

**So deleting the night is the wrong instinct** — it discards good physiology that the EMA baselines
need, and after Q-506 those baselines are already fragile. **Keeping it as-is is worse**, because
every duration-derived number treats a 3-hour observation as a 3-hour night.

---

## 2. The owner's concern, quantified

`GET /api/user/bedtime-estimate` averages sleep starts over a **14-day** window via
`computeSleepStartConsistency`. `minutesFromNoon(04:23)` = **983**, against roughly **660** for an
11 pm bedtime. One such night in fourteen moves the mean:

```
(13 × 660 + 983) / 14 = 683   →  the estimated bedtime reads ~23 minutes later, for two weeks
```

**`nightSessions()` cannot help here.** It exists to reassemble a night split by a wake-up so the
start is the real bedtime rather than the 02:23 restart (Q-76) — but that needs an earlier fragment to
reassemble, and here the ring was off. A 4:23 start is a standalone night to every consumer.

---

## 3. Q-519 — manual bedtime entry, writing exactly one column

**The owner proposed this and it is better than the partial-flag-only approach**: smaller, targeted at
the stated concern, and it fits machinery the app already has.

`lib/data/health-source.ts` merges **per field, not per row** — its own comment gives this exact
rationale: *"a manual weight must not stop the ring's HRV or Health Connect's steps from"* being kept.
`manual` is rank 5, `oura_ble` rank 3.

So a manual bedtime that writes **only `sleep_start`**:

| column | source after | value |
|---|---|---|
| `sleep_start` | **manual (5)** | 11 pm — the truth the ring missed |
| `duration_hours`, `efficiency`, `average_hrv_ms`, `lowest_heart_rate`, `respiratory_rate` | oura_ble (3), **untouched** | as measured |

The bedtime estimate then reads the real value and the ~23-minute drag disappears. **No new schema, no
new merge logic.**

### 3.1 The invariant this rests on — write it down or it breaks

`duration_hours`, `time_in_bed_hours` and `efficiency` are **stored columns on `sleep_sessions`, not
derived from `sleep_end − sleep_start`.** That is the only reason this is safe.

**If anyone later recomputes duration or efficiency from the start/end span, this design silently
produces a 9-hour night at 34% efficiency.** The safety is an invariant, not an accident, and the
implementing PR should say so beside the write.

**Manual bedtime must therefore write `sleep_start` and nothing else** — not duration, not efficiency,
not a synthesised `sleep_end`.

### 3.2 What it does NOT fix

The 3h 5m still reaches the **sleep score**, **readiness's `previousNight` contributor**,
**resilience's `sr`**, and the **Body Battery anchor**. Those read a genuinely-measured-but-incomplete
night as a bad night. Q-519 is deliberately not trying to fix that.

---

## 4. Q-520 — the partial-night flag (separate, larger, second)

A nullable marker on the session that excludes the duration-derived metrics from the sleep score and
from the trailing baselines, while leaving the physiological columns flowing.

**Make it manual, not auto-detected.** An automatic "this looks partial" rule would eventually
suppress a genuinely bad short night — which is exactly what the recalibrated sleep score (Q-503)
exists to surface. The cost of wrongly hiding a real bad night is higher than the cost of a tap.

**Reversal cost is low** for both: a nullable column plus filters. Unset and the night returns.

---

## 5. Sequencing, and the recommendation

1. **Q-519 first.** Small, uses existing per-field merge, fixes the owner's stated concern exactly.
2. **Q-520 if the score distortion still bothers the owner once they see it.** Bigger, and it is
   easier to judge whether it is worth building after Q-519 has removed the timing noise.

---

## 6. What was not exercised

- **No code changed, and nothing was written to production.** The `claude_ro` role is read-only —
  enforced by the Postgres role, not by SQL inspection — so this night could not be, and was not,
  edited or marked by this agent.
- **The per-field merge behaviour is read from `health-source.ts` and its comments, not demonstrated.**
  No test was run showing that writing `sleep_start` at `manual` leaves `average_hrv_ms` at
  `oura_ble`. That is the load-bearing assumption of Q-519 and **the implementing PR should prove it
  with a test before relying on it.**
- **Whether any consumer recomputes duration/efficiency from the start/end span was NOT audited.**
  §3.1 states the invariant the design needs; it does not establish that the invariant currently
  holds everywhere. That audit is part of implementing Q-519, not a conclusion of this review.
- **The ~23-minute figure assumes 13 otherwise-normal nights at a ~11 pm bedtime** and one outlier. The
  owner's actual 14-day window was not pulled; the arithmetic shows the mechanism and magnitude, not a
  measured current value.
- **No sleep-session delete or edit path exists** in `lib/data/repository.ts`, and no manual sleep-entry
  UI was found — so there is nothing the owner can do about this night today. That is why the answer is
  a proposal rather than an action.
- Screenshot values are as reported by the owner's device on 2026-08-19; trailing averages (8h, 92%,
  59 ms, 53 bpm) are read from that same screen.
