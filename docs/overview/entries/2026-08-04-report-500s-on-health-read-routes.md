# 2026-08-04 — make the two 500'ing health read routes reportable

**Branch:** `fix/report-500s-on-health-read-routes` · **Domain:** platform

## What this is

Follow-on to the `body_metrics` arity fix (#1046). The same device console dump showed
`/api/body-battery` and `/api/readiness-score` both returning **500** in production. This PR does
**not** fix them — it makes the next occurrence diagnosable, which it was not.

## What was actually established

- **Transient, not deterministic.** `body_battery_daily` holds a row for 2026-08-04 with
  `updated_at = 2026-08-03T23:19:53Z` — the route completed successfully ~6 minutes after the 500s,
  from the same data. A data-shape fault would not self-heal. This is the one hard fact.
- **Nothing was logged.** Neither route had a `catch`. Queried `error_events` for the window: ten
  React #418 hydration errors, zero server rows. There was no stack to work from at any point.
- Both return **200 locally** against the seeded DB.
- Migrations are not behind — prod's `schema_migrations` head is `166_…`, matching the directory.
  Ruled out as a cause.

## The change

Both handlers keep auth + rate-limit inline, then `try { return await build…(userId, tz) }` with
`reportServerError(err, { userId, url })` and a JSON 500 in the `catch`. The bodies moved verbatim
into `buildBodyBattery` / `buildReadinessScore`; neither used `session` for anything but `userId`
and `tz`, so the extraction is mechanical.

**Verified the catch path end-to-end** rather than assuming it: injected a throw, confirmed the
route returned `{"error":"Body battery unavailable"}` with status 500 **and** that a row with the
full stack, `url` and `userId` landed in `error_events`. Then reverted the probe and re-confirmed
200. Both routes exercised against `pnpm dev` with a real credentials session.

## Hypothesis, recorded as a hypothesis

The pool is `max: 10` / `connectionTimeoutMillis: 5_000`; a failed acquire throws, which in an
unwrapped handler is exactly a bare 500. These two routes have the largest per-request fan-out in
the codebase — `readiness-score` 11 concurrent `repo.*` calls, `body-battery` 8 (`day-timeline` next
at 10) — so they starve first under contention, and the arity bug was making the device retry sync
pulls in a loop at the same time.

Coherent, but **unproven, and it should not be written down as the cause.** It does not explain why
`day-timeline` was not also affected. One logged stack decides it.

## Deliberately not done

- **No pool change.** `max` is load-bearing (`max` × replicas vs Railway's connection limit) and
  tuning it against an unproven hypothesis is how the session-165 outage happened.
- **No sweep of the other 189 routes.** Filed as **Q-58** — it is a whole-tree diff and the shape of
  the fix (per-route wrapper vs Next's global `onRequestError`, which cannot see the session) is an
  open decision, not a mechanical one.
- **No version/changelog bump** — the user-visible behaviour is unchanged. A 500 was a 500 before;
  `cachedFetch` swallows `!res.ok` either way.

## Not verified

Production. The fault did not reproduce locally and by construction cannot — the change is only
observable the next time the real thing fails. Nothing here was exercised on device.
