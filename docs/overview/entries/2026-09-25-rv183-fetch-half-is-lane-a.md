# 2026-09-25 — RV-183's remaining fetch half is Lane A's, and the "today" envelope is Brisbane-keyed (LB-150)

**Branch:** `lane-b/rv183-fetch-half-is-lane-a` · **Lane:** Implementation B · **Docs only**

Lane B picked RV-183 back up expecting to remove the three resume-time fetches that duplicate
Home's. Reading the code first, as the entry's own retracted exercise-catalogue claim argues for,
turned up two things that changed what the work is.

## The remaining half cannot be done in Lane B, and should not be forced

All four reads — `next-session`, `readiness-score`, `body-battery`, and the warm list's own — are
`cachedFetchToday`. Plain `cachedFetch*` paints from cache and then **always** revalidates, so each
resume spends a GET on an entry that is already fresh. `freshWithinTtl` is exactly the flag for
that, and **`cachedFetchToday` hardcodes `undefined` for it** (`lib/sqlite/cache.ts:604`, 7th
positional argument), so it is unreachable from every today-envelope key. Exposing it is one line
in Lane A's file, and it composes: the today-check is in the unwrap, the TTL check in
`isFreshWithinTtl`.

Two Lane-B-only shapes were examined and both rejected:

- **`getCached()` first, fetch on miss** — the warm-list runner's own shape, 300 lines up in the
  same file, and TTL-aware. But it returns the raw `{date, data}` envelope and neither
  `unwrapToday` nor `TodayEnvelope` is exported, so three call sites would hand-roll a date
  comparison. That comparison is defective (below), so this would have copied the defect three
  times to keep the item in this lane.
- **`readTodayCacheSync()`** — keeps the unwrap in one place, but is not TTL-aware. A health-alert
  reconcile would act on a reading up to a Brisbane day old.

The structural call: ask Lane A for the one-line enabler rather than hand-roll. Reversal cost is
nil — once the flag is exposed the call sites gain one argument each.

## LB-150 — the envelope rolls over at Brisbane midnight for everyone

`unwrapToday` compares `envelope.date !== todayInTz()` (`cache.ts:546`) and the writer stamps
`todayInTz()` (`:603`). Both are the bare Brisbane default, so they agree with each other — which
is why no test catches it and why the sync-provider's recent writer/reader fix, which corrected a
genuine *disagreement*, left it alone.

Server routes compute "today" in the user's zone. The envelope rolls in Brisbane's. Between the
user's midnight and Brisbane's, a reading from the user's previous day still satisfies the guard
and is served as current — 14 hours a day in New York, the same window Q-478 measured for the two
guards commented immediately below this function. The comment there already states the rule;
`unwrapToday` is the one that takes no `tz` at all.

~10 keys write the envelope and ~14 read it, including readiness, body-battery, next-session,
supplements, weekly-stats, training-load and training-stress. Filed `Lane: A` — both sides have to
move together, because changing one leaves writer and reader disagreeing, which makes an entry
unreadable the moment it lands.

## Not done

No code changed. Nothing here was verified on device; it is a source reading, and the claims that
matter (the `undefined` argument, the two bare `todayInTz()` calls) are line-cited so the next
reader can check them in one grep rather than trusting this note.
