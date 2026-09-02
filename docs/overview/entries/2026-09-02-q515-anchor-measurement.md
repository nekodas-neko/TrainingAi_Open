# 2026-09-02 — Q-515: the recommended fix is a level change wearing a stability fix's clothes

**Branch:** `claude/la-q515-anchor-measurement` · **Agent:** Implementation Lane A · Docs only.

Q-515 is careful to separate two questions — *(a) is the rest/active boundary stable?* (no, a defect
regardless of taste) and *(b) is 8.2% of waking samples the right at-rest level?* (unknown, and the
owner's) — and it says outright that fixing both at once makes neither verifiable. Its recommended
fix does both.

Swapping `resolveHrProfile`'s 28-day resting mean for a 90-day trailing one moves the boundary
**+3.42 bpm** and takes the at-rest share of waking samples from **14.9% to 25.9%** — a **74%
relative rise, on 56 of 57 days**. The instability it is meant to fix took the same statistic from
26.5% to 8.2%. The fix is the same order as the defect and points the other way.

**The direction is structural.** During an improving trend a longer window necessarily sits above a
shorter one, because it still contains the older, higher values — resting HR fell 62.9 → 54.4 over a
month, and today the 28-day mean reads 52.2 against the 90-day's 56.1. No window length separates
stability from level while fitness is moving. **And the window is not doing the work anyone assumes:**
there are only **74 days** of resting HR in the whole series, so a 90-day trailing window covers
**72 of them**. Its stability today comes from having nothing to drop yet.

What fixes (a) alone is the entry's own second option — **freeze the anchor** at a stated constant
with a date, so the boundary is unchanged on the switchover day and cannot drift afterwards. Its
cost is worth stating rather than hiding: a frozen constant goes stale silently, and there is no cron
layer in this app, so "re-derived quarterly" means a person remembers.

So the entry is now `Gate: owner`, with the numbers it was missing. This is the measurement CLAUDE.md
asks for by rule — *a proposal is incomplete until it states how many other days the change moves* —
and it was the one thing the entry did not have.

**One thing noticed while measuring, not filed:** `daily_zone_minutes` stores `max_hr = 187` on all
88 of its rows (min = max), the age-predicted value, never the observed ceiling the entry describes
maturing to ~171. It does not affect this result — `∂boundary/∂maxHr` is 0.05, and the term cancels
out of a difference between two anchors — but it does not match the entry's account of that profile,
and the table is a cache whose staleness is a legitimate cache miss rather than a defect.

**Not exercised:** no code changed. The measurement is production read-only and covers the owner's
own rows, as every `claude_ro` read does.

[`docs/reviews/2026-09-02-hr-rest-anchor-level-shift.md`](../../reviews/2026-09-02-hr-rest-anchor-level-shift.md)
