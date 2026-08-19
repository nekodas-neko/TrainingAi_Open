# The sleep score is stamped 23 seconds before the night finishes arriving

**Date:** 2026-08-20 · **Agent:** Tuning 🎶 · **Pillars:** `[sleep]` `[devices]` `[readiness]`
**Owner report:** *"that wake up time is way off, I woke up around 6am"* — screenshot at 06:46
Brisbane showing **9:52 pm – 4:52 am, 6.5 h, score 47**.

**Two answers, and only one of them is reassuring.** The wake time was a mid-sync snapshot and the
session row is already correct. **The score is not, and nothing recomputes it.**

---

## 1. The session healed; the screenshot caught it one minute early

| | app at 06:46 | `sleep_sessions` now |
|---|---|---|
| window | 9:52 pm – **4:52 am** | 9:52 pm – **6:44 am** |
| duration | 6.5 h | **7.75 h** |
| deep | 0.8 h | **1.08 h** |
| REM | 1.4 h | 1.42 h |
| light | 4.3 h | **5.25 h** |
| awake | 0.5 h | **1.17 h** |
| HRV | 58 ms | 60 ms |
| lowest HR | 52 | 51 |

`sleep_sessions.updated_at` = **06:46:19**, the same minute as the screenshot. The stored wake time
now matches the owner's own account of waking around 6 am. **Nothing is wrong with the sleep data.**

---

## 2. The score was computed 23 seconds too early, and is not revisited

`oura_daily_derived` for 2026-08-20:

| field | value |
|---|---|
| `sleep_score` | **47** |
| `computed_at` | **06:45:56** |
| `sleep_sessions.updated_at` | **06:46:19** |

**The score predates the data by 23 seconds.** Re-checked at 06:49:04 — still 47, still stamped
06:45:56. It did not self-heal in the three minutes after the session extended, and no path
recomputes a derived score when its underlying session grows.

Its stored contributors confirm what it was computed against:

```
{hr 67, hrv 60, timing 63, latency 59, schedule 48,
 rem_sleep 63, deep_sleep 59, efficiency 81, restfulness 86, total_sleep 54}
```

`total_sleep: 54` is a 6.5-hour value. The truncation depresses **several** contributors at once —
`total_sleep`, `deep_sleep`, `rem_sleep` and `efficiency` all read the partial night — which is why
the composite lands so low rather than losing a point or two.

### The comparison that settles it

| date | duration | efficiency | onset | **score** |
|---|---|---|---|---|
| **2026-08-20** | **7.75 h** | 87% | 30 m | **47** |
| 2026-08-17 | 7.58 h | 90% | 35 m | **78** |
| 2026-08-14 | 7.42 h | 90% | 10 m | **88** |
| 2026-08-19 *(ring fitted at 4 am)* | 3.5 h | 86% | 15 m | 39 |

**2026-08-17 is a near-twin — 7.58 h, 90%, 35 m onset — and scores 78.** Today's night scores **31
points lower** on slightly *more* sleep. And it sits 8 points from the 3.5-hour night when the ring
was off the finger for most of it. A reader cannot distinguish "genuinely bad night" from "score
stamped mid-sync", because they look identical.

---

## 3. Why this is not the same as Q-520

**Q-520** covers a night that is *genuinely* incomplete — the ring was not worn, so the data is
missing and the score is arguably right to be low. **This is a complete night scored against a
partial copy of itself.** The remedies differ: Q-520 wants the incompleteness surfaced; this wants
the score recomputed when its inputs change.

They share one thing worth building once: **readiness already has the vocabulary.**
`readiness_contributors` stores a `provisional: true` flag per contributor, and this session's
[score-audit-trail review](2026-08-19-score-audit-trail.md) called that flag the reference for a good
audit trail. Sleep stores no equivalent, so a score computed on partial data is indistinguishable
from one computed on a finished night — the exact information the flag exists to carry.

---

## 4. What to do — filed as Q-529

**Recompute the derived scores when the session they read is updated**, rather than stamping once on
first ingest. Failing that, mark the score provisional until the night's session stops growing, so a
low number carries the reason.

**How often does this bite?** Every morning the app is opened while the ring is still uploading —
which is the normal way to check last night's sleep. The window is small (~seconds to minutes) but it
sits exactly where the user is looking.

**Pass test:** extend a session after its score is written and confirm the score changes. Concretely,
2026-08-20 should re-score well above 47 — the near-twin on 08-17 suggests the high 70s.

**Caveats.** One night, one athlete, `claude_ro` row-scoped. **The 23-second ordering is exact**
(both timestamps are stored) and the failure to recompute is confirmed over a 3-minute re-check —
**it is not confirmed over hours**, so a slower nightly pass may still correct it. That is the first
thing to check before building anything, and it is cheap: re-read `computed_at` for 2026-08-20
tomorrow. If it has moved, this is a latency problem and not a correctness one, and the fix shrinks
to surfacing provisionality.
