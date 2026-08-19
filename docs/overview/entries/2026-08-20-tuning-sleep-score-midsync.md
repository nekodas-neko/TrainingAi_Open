# 2026-08-20 — The sleep score is stamped 23 seconds before the night finishes arriving (Q-529)

**Agent:** Tuning 🎶 · **Branch:** `tuning/stale-sleep-score-midsync` · **Docs-only.**

**Owner report:** *"that wake up time is way off, I woke up around 6am"* — screenshot at 06:46
Brisbane showing 9:52 pm – 4:52 am, 6.5 h, score 47.

Two answers, and only one is reassuring.

## The session was already right

`sleep_sessions` stores 9:52 pm – **6:44 am**, **7.75 h**, `updated_at` **06:46:19** — the same minute
as the screenshot, and matching the owner's own account. The app had caught a mid-sync snapshot.

| | app at 06:46 | stored now |
|---|---|---|
| wake | 4:52 am | **6:44 am** |
| duration | 6.5 h | **7.75 h** |
| deep | 0.8 h | **1.08 h** |
| light | 4.3 h | **5.25 h** |
| awake | 0.5 h | **1.17 h** |

## The score was not, and did not fix itself

| field | value |
|---|---|
| `sleep_score` | **47** |
| `computed_at` | **06:45:56** |
| `sleep_sessions.updated_at` | **06:46:19** |

**The score predates its own input by 23 seconds.** Re-checked at 06:49:04 — still 47, still stamped
06:45:56. Its stored contributors show what it read: `total_sleep 54` is a 6.5-hour value, and
truncation depresses `total_sleep`, `deep_sleep`, `rem_sleep` and `efficiency` **together**, which is
why the composite falls so far rather than a point or two.

| date | duration | eff | onset | score |
|---|---|---|---|---|
| **2026-08-20** | **7.75 h** | 87% | 30 m | **47** |
| 2026-08-17 | 7.58 h | 90% | 35 m | **78** |
| 2026-08-14 | 7.42 h | 90% | 10 m | **88** |
| 2026-08-19 *(ring fitted 4 am)* | 3.5 h | 86% | 15 m | 39 |

**A near-twin night scores 31 points higher, and this one sits 8 points from a night the ring spent
mostly off the finger.** A reader cannot tell "bad night" from "stamped mid-sync".

## Not a duplicate of Q-520

Q-520 covers a night that is *genuinely* incomplete, where a low score is arguably correct. This is a
**complete night scored against a partial copy of itself**. They share one remedy worth building
once: readiness already stores a **`provisional`** flag per contributor — the reference this session's
score-audit-trail review named — and sleep stores no equivalent.

## The caveat that must be checked before anyone builds

The failure to recompute is confirmed over **three minutes, not hours.** A slower nightly pass may
still correct it, which would shrink this from a correctness problem to a latency one and reduce the
fix to surfacing provisionality. **Re-read `computed_at` for 2026-08-20 tomorrow** — one query, and it
decides the shape of the work. Written into Q-529 as the first action, ahead of any implementation.

## Files

- `docs/reviews/2026-08-20-sleep-score-computed-mid-sync.md` (new)
- `docs/implementation-backlog.md` — Q-529
- `docs/domains/sleep/README.md`, `docs/agents/state/tuning.md`
- `scripts/check-doc-index-size.js` — backlog baseline 11307 → 11342

**Q band exhausted.** 500–529 is fully used; the next Tuning session needs a new range agreed before
filing anything. Recorded at the top of the baton.

## Not exercised

Docs-only; no code path changed. The 23-second ordering is **exact** — both timestamps are stored
columns, not inferred. Everything else is `claude_ro`, row-scoped, one night, one athlete. No device
check: the report came with screenshots and the server state answered it.

---

# Follow-up the same morning: "it changed again… and it's still wrong"

At 06:51 the app had caught up to the server — 7.8 h, 9:52 pm – 6:44 am — and the owner replied that
it had changed again and was still wrong. Both halves have an answer, and the second is a **different
defect** from the stale score above.

**"It changed again"** — sync was still landing. Across three reads the session end moved
**4:52 → 6:44 → 6:47 am** and `awake_hours` **1.17 → 1.25 h**. Converging, not malfunctioning. It
*reads* as instability only because nothing marks a still-syncing night as provisional.

**"Still wrong"** — the numbers are right; the label is not. Decoding `sleep_phase_5_min`
(`'1'=deep '2'=light '3'=REM '4'=awake`), the night's last **8 epochs are `4`** — 40 minutes awake at
the end. Session end 06:47 − 40 min = **last sleep epoch ≈ 06:07**, which is *"around 6am"* almost
exactly.

**So the ring is right and the app already knows the answer.** The row renders the **in-bed span**
(8.92 h) where a reader expects the sleeping window, while the figure beside it is time **asleep**
(7.75 h) and 1.25 h of the span is awake — 0.5 h onset latency plus ~40 min lying awake at the end.
**The wake moment the owner recognises is in the stored hypnogram and shown nowhere.**

Filed as a **`projectOverview.md` Known Issue, not a queue entry** — the Tuning band (500–529) is
exhausted at Q-529 and taking a number from another agent's band would collide. It needs a number
once the band question is settled. It is Lane B's (presentation), unlike Q-529 which is Lane A's
(recompute).

**Method note worth keeping:** the answer came from decoding the stored hypnogram, not from the
summary columns. `duration_hours`, `awake_hours` and `sleep_end` cannot distinguish "woke at 6:07 and
lay in bed" from "slept until 6:47" — **the per-epoch string can, and it was already stored.** Reach
for it before concluding a timestamp is wrong.

---

# ⚠️ Correction, hours later: the score does recompute, and the twin was not a twin

The caveat written into Q-529 asked for one cheap check before anyone built a recompute path. It ran
at 06:59:32 and refuted the entry's central claim.

| | at 06:49 | at 06:59 |
|---|---|---|
| `sleep_score` | 47 | **55** |
| `computed_at` | 06:45:56 | **06:54:41** |
| `sleep_sessions.updated_at` | 06:46:19 | **06:51:03** |

**The score recomputed**, after the session settled. "Nothing recomputes it" was wrong — the ordering
that looked broken was a snapshot of a pipeline mid-run.

**The near-twin comparison also fails.** 2026-08-17 matched on *duration and onset* — the columns that
happened to be in the query — and differs where the model actually looks:

| contributor | 08-20 (55) | 08-17 (78) |
|---|---|---|
| `rem_sleep` | 63 | **99** |
| `efficiency` | 57 | **82** |
| `deep_sleep` | **76** | 62 |
| `hrv` | **67** | 52 |

REM **1.42 h vs 2.08 h**, efficiency **86% vs 90%**, awake **1.25 h vs 0.83 h**. **The remaining 23
points are the score working, not failing.**

**What survives:** a **~9-minute window (06:45:56 → 06:54:41)** in which a provisional score renders
as final, with nothing marking it — landing exactly when someone checks last night's sleep. Same root
as the range-label Known Issue and as Q-520. Q-529 re-scoped **Lane A → Lane B** and merged with that
Known Issue rather than standing beside it.

**Two mistakes compounded, and both were avoidable:**

1. **A three-minute observation used to assert a permanent absence.** The entry itself said the
   finding was confirmed over three minutes and not over hours — the hedge was written and the
   conclusion ignored it.
2. **A "twin" chosen on the summary columns that happened to be adjacent in the query** rather than on
   the contributor vector the model reads.

Both would have been caught by the same discipline — **compare contributors, not summary columns** —
which is exactly what the hypnogram decode did an hour later, and it got its answer right first time.

---

# Owner requirement: accurate on first open — and the cause is neither scoring nor rollup

> *"Ideally I want the score and sleep time to be accurate on first open of the day without needing
> time to 'adjust'."*

**The ring uploads roughly once an hour.** Over 7 days, 214 ingest batches in `oura_raw_samples`:

| | minutes |
|---|---|
| median gap | **62.0** |
| p90 | 71.0 |
| max | 306 |

Each batch is a short high-rate burst — the 01:13 batch holds 1,899 samples covering 01:05–01:13 — so
the ring records in bursts and ships them hourly rather than streaming.

## What that produced

| time | event |
|---|---|
| ~06:07 | last sleep epoch (stored hypnogram) |
| **05:40** | **last upload before the app was opened** |
| **06:46** | **app opened** → shows a night ending **4:52 am** |
| 06:44 → 06:46:19 | upload lands → session ends **6:44** |
| 06:50 → 06:51:03 | upload lands → session ends **6:47** |
| 06:54:41 | score recomputed → **55** |

**The app was opened in the gap between two hourly uploads. The wake was still on the ring.** No
scoring or rollup change could have helped — the server did not have the data.

Drain lag vs wake over 8 nights: +3, +9, **−5**, +2, +17, **+62**, +4 min. The **−5** is the
instructive one — on 08-18 the night was complete *before* the wake timestamp. Whether today's summary
is right on first open is **where waking falls in the upload cycle: luck, not design.**

## What the requirement actually needs

1. **Drain on app open / wake detection** — closes the ≤62-min gap, the dominant term. **Native
   Kotlin ⇒ new APK.**
2. **Roll up and re-score on that drain** — ~4 minutes of processing lag today.
3. **Until both land, don't render a number that will change** — Q-529's existing scope, and the only
   part shippable without an APK.

**Doing 2 without 1 makes the app faster at showing stale data.** Shortening the rollup schedule alone
fixes a 4-minute term and leaves a 62-minute one — which would read as *"we made it faster and it
still adjusts"*.

## The limit, said out loud rather than discovered later

**Open the app before the ring has registered the end of the night and nothing fixes it.** That
morning the session's own end timestamp was **06:47** and the screenshot was **06:46**. The achievable
target is *"accurate within seconds of the ring knowing"*, not *"accurate before the ring knows"*.

Three distinct states — night in progress, complete but unsynced, settled — and **the app renders all
three identically.** That is the same root as the range-label Known Issue and Q-520.

## Not measured, and it gates the recommendation

**The 62-minute cadence is observed ring behaviour, not a documented setting.** Whether it is
configurable, and what more frequent radio wake-ups cost in ring battery, is unknown here — and the
firmware is deliberately frozen, so this is not a free knob. **Check before promising the on-open
drain is cheap.**
