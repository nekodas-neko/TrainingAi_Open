# Review — turning an ms offset into a calendar day, and what it does in a DST zone

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** the AI/stats time-window rule
**Findings filed:** Q-489 · **Clean results recorded:** two

## Why

`CLAUDE.md` bans a specific shape and records that it shipped six times in one file:

> Time windows for stats/AI tools anchor at `todayMidnightUtc(tz)`, never `Date.now() − N×86400000` —
> six copies of the banned ms-offset pattern shipped in `lib/ai-chat/tools.ts` (2026-07-06 review)
> after the same class was fixed in session 62.

`lib/ai-chat/tools.ts` is clean now. But 12 instances of the pattern remain elsewhere, and nobody had
sorted the ones that matter from the ones that do not.

## Most of the 12 are correct, and filing them would be wrong

The rule's harm is *"ms-offset windows straddle two AEST days and **merge them**"* — that is about
**day-bucketed** aggregation. A rolling instant filter is a different thing and is often the right
thing.

`app/api/muscle-recovery/route.ts:23` is the clearest example: `from7d = new Date(Date.now() - 7d)`
feeds `repo.getWorkoutSessionsFrom(userId, from7d)` → `computeMuscleRecovery`, which works from
`ws.startedAt.getTime()` — **hours since training**, no day buckets anywhere. Muscle recovery is a
physiological process measured in hours; a calendar-day window would be *less* correct. Same for
`workout-load-history` (90-day rolling) and `friends/feed` (30-day rolling).

**A sweep that grepped the banned pattern and filed all 12 would be filing mostly false positives.**
This is the fifth consecutive sweep in which the mechanical version of a check was wrong.

## Finding (Q-489) — the five that produce a calendar day, and one is measurably wrong

Five sites convert an ms offset into a **date string**, which is day arithmetic done by hand:

```
lib/data/postgres/adapter.ts:1710   toAestDay(new Date(Date.now() - 14 * 86_400_000), timezone)
lib/data/postgres/adapter.ts:1722   toAestDay(new Date(Date.now() - 86_400_000), timezone)
lib/achievements.ts:50              formatInTimeZone(new Date(Date.now() - 86_400_000), tz, 'yyyy-MM-dd')
packages/shared/src/ai-periodization/signals.ts:197
                                    toAestDay(new Date(Date.now() - 24 * 3_600_000), tz)
app/api/progress-summary/route.ts:31
                                    formatInTimeZone(new Date(Date.now() - 7*24*60*60*1000), tz, 'yyyy-MM-dd')
```

**Measured, not reasoned.** In `America/New_York`, across the 2026 DST transitions:

```
ok             local now=2026-03-08 00:30   now-24h → 2026-03-07   true yesterday=2026-03-07
ok             local now=2026-03-09 01:30   now-24h → 2026-03-08   true yesterday=2026-03-08
ok             local now=2026-11-01 00:30   now-24h → 2026-10-31   true yesterday=2026-10-31
** MISMATCH ** local now=2026-11-01 23:30   now-24h → 2026-11-01   true yesterday=2026-10-31
```

On the **25-hour fall-back day**, in its last hour, `now − 24h` lands on **today**. Three of the five
sites are computing "yesterday" that way, so on that one hour a year they compute *today* instead:

- `adapter.ts:1722` — the range start for `getOuraDailyDerived(userId, <start>, todayIso)`, so
  yesterday's derived row drops out of the AI-dynamic prescription inputs.
- `lib/achievements.ts:50` — `yesterdayStr`, used for streak continuity.
- `signals.ts:197` — `yesterday` in the periodization signal chain.

### Severity, stated plainly

**Unreachable today and very low even when reachable.** Every user is `Australia/Brisbane`, which has
no DST, so this cannot currently fire at all. When it can, it is **one hour per year per user in a
DST zone**.

It is filed anyway because it is *measured*, the fix is a one-line swap to a helper that **already
exists and is already used elsewhere**, and it is precisely the hand-rolled date arithmetic
`CLAUDE.md` bans: *"Never hand-add to calendar components … Use `Date.UTC` overflow normalisation or a
`packages/shared/src/date-utils.ts` helper."*

**Q-477 is what makes it reachable at all** — the Profile timezone setting (with its auto-detect
button) is how a user ends up in a DST zone. These two belong to the same family and neither is
urgent.

### Fix shape

`shiftDateStr(todayInTz(tz), -1)` for the three "yesterday" sites, `-14` and `-7` for the other two.
`shiftDateStr` (`packages/shared/src/date-utils.ts:154`) does the arithmetic on the date string with
`Date.UTC` overflow normalisation — exactly what the rule asks for — and
`lib/data/postgres/slices/oura.ts:1182` already uses it in this shape
(`shiftDateStr(todayInTz(opts.timezone ?? DEFAULT_TZ), -30)`). Nothing new is needed.

## Clean results

- **`lib/ai-chat/tools.ts` carries none of the banned pattern.** The six copies the 2026-07-06 review
  found are gone; that fix held.
- **The rolling-window uses are correct and must not be "fixed"** — `muscle-recovery`,
  `workout-load-history`, `friends/feed` and the `getWorkoutSessionsFrom` calls filter by instant and
  feed consumers that work in hours, not day buckets.

## Not verified

The DST mismatch was measured with `date-fns-tz` directly, not by driving the app with a DST-zone user
at that hour — the app cannot be time-travelled in this harness (`faketime` shifts node's clock but
not Postgres's, per `CLAUDE.md`). The consequence at each of the three call sites is read from source,
not observed.
