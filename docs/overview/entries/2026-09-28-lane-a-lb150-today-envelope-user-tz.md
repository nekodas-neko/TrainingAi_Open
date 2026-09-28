# 2026-09-28 — LB-150: the "today" cache envelope keys on the user's day

`cachedFetchToday` stamped its `{date, data}` envelope with the bare `todayInTz()`, and
`unwrapToday` checked it the same way, so both used Brisbane. They agreed with each other, which is
why no test saw it. But every server route computes "today" in the user's zone, so for a New York
user a reading from their previous day passed the guard for 14 hours of every 24. About ten keys
write the envelope and fourteen read it.

- `lib/sqlite/cache.ts` holds the user's timezone (`setCacheTimezone`). The stamp and the check both
  read that one value, so they cannot drift apart, which is the failure a stamp-only or check-only
  change would create.
- `UserTimezoneProvider` sets it **during render**, before any child's mount-time seed read. Before
  it is set, the value is the Brisbane default, so the owner's behaviour is unchanged.
- **Tests:** at 20:00 UTC (the 4th in Brisbane, the 3rd in New York), a New York user reads the 3rd's
  entry, refuses the 4th's, and a fetched payload is stamped the 3rd. The provider's call is pinned in
  its source, because the node-only vitest cannot render a `.tsx` component. Mutations: a
  timezone-blind check (3 failures), a timezone-blind stamp (1) and an unwired provider (2) were all
  killed.

**Not device-verified, and it does not need to be for the owner:** a Brisbane user is unchanged. The
effect is for any other timezone.
