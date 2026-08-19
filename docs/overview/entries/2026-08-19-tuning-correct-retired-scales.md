# 2026-08-19 — Three "self-report" scales were retired, and I compared them as live (correction)

**Agent:** Tuning 🎶 · **Branch:** `tuning/correct-retired-scales` · **Docs-only. No new findings.**

The owner, on being asked whether to reword or drop `resting_soreness`: **"I thought we removed
this?"** They had. The ask was wrong and the review behind it was misleading.

## What was wrong

[`2026-08-19-sleep-validation-targets.md`](../../reviews/2026-08-19-sleep-validation-targets.md) §2
compared six self-report scales as though all six were still being collected. **Three are retired**,
and `components/morning-checkin-sheet.tsx` says so in its own comment:

```ts
// Retired scales — always null so a re-save clears any historical value.
motivation:        null,
restingSoreness:   null,
wakeMood:          null,
```

Last stored value per field:

| field | last value | status |
|---|---|---|
| `sleep_quality_feel` | 2026-08-19 | ✅ live |
| `perceived_recovery` | 2026-08-19 | ✅ live |
| `physical_tiredness` / `mental_drain` | 2026-08-17 | live, barely used, written elsewhere |
| `motivation` | 2026-08-07 | ⛔ retired |
| **`resting_soreness`** | **2026-07-23** | ⛔ **retired** |
| `wake_mood` | 2026-07-20 | ⛔ retired |

## What survives, and what is withdrawn

**The conclusion survives and gets stronger.** Among scales still collected, the comparison is
`sleep_quality_feel` (sd ~0.8 across 5 values) against `perceived_recovery` (sd 0.36 across 2) — a
field of two, not six. The sleep rating is the most variable live self-report by a wide margin, which
is the point the review was making.

**Withdrawn:** the recommendation to reword or drop `resting_soreness`. It was dropped on 2026-07-23.
**Its constant 3 is the fossil of a retired question, not a live data-quality problem** — and a
constant value is a plausible reason it was retired in the first place.

## The lesson, recorded in the baton

**A column with rows is not a live field.** `SELECT … WHERE col IS NOT NULL` cannot distinguish "this
field is broken" from "this field was removed and these are its last rows". One `max(log_date)` per
column would have caught it before it reached the owner as a question. A constant value is a symptom
of a retired question at least as often as a broken one.

## Observed and deliberately not filed

The three retired columns still carry full plumbing — local SQLite column, `RECONCILE_COLUMNS` entry,
sync-engine mapping, adapter upsert arm. Removing them touches migrations, the local store and the
sync path for no user-visible benefit, and dead columns cost essentially nothing. Recorded so the next
reader knows it was seen rather than missed.

## Files

- `docs/reviews/2026-08-19-sleep-validation-targets.md` — §2 rewritten with live/retired status
- `docs/implementation-backlog.md` (Q-72), `docs/domains/sleep/README.md`,
  `docs/overview/entries/2026-08-19-tuning-score-audit-trail.md` — the same claim corrected where it
  was repeated
- `docs/agents/state/tuning.md` — the lesson

## Not exercised

Docs-only; no code path changed. Field status is read from `max(log_date)` per column in `claude_ro`
(row-scoped to the owner) **and** confirmed against the write site in `morning-checkin-sheet.tsx`.
