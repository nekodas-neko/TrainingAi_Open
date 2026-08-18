# Review — the admin date-range routes, and a loop that does not terminate

**Date:** 2026-08-18 · **Agent:** Review 📖 · **Sweep 31** · **Finding:** Q-497

## Why this lens

Sweep 30's lesson was that *"needs configuration"* had kept a surface untested for 29 sweeps and was
never a real barrier. `app/api/admin/day-review/route.ts` is the **other** secret-gated route —
`ADMIN_EXPORT_SECRET` — so this sweep applied that lesson immediately rather than filing it as a
suggestion.

`CLAUDE.md` makes three specific claims about this route. All three hold.

## What holds — checked, not assumed

| Claim in `CLAUDE.md` | Verdict |
|---|---|
| "Read-only, GET-only" | ✅ `GET` is the only export |
| "fail-closed: unset either var and the bearer path is disabled entirely — never skipped" | ✅ `!expected \|\| !exportUserId` rejects before the compare |
| "the resolved user must still be an admin — the token widens *transport*, never authority" | ✅ `requireAdmin(exportUserId)` runs on the token path, and per Q-479 `requireAdmin` always checks the DB |

The route is otherwise carefully built: `end < start` is guarded, `MAX_RANGE_DAYS` bounds the fan-out,
the day loop is sequential **on purpose** with a comment citing the session-165 pool exhaustion, and
the date params go through `normalizeDateParamIso`.

## That last one corroborates Q-496 directly

`normalizeDateParamIso` was probed with the same inputs that produced HTTP 500s on
`health-connect/ingest`:

| Input | `day-review` (`normalizeDateParamIso`) | `health-connect/ingest` (raw regex) |
|---|---|---|
| `2026-13-45` | `null` → **400** | **500** + `error_events` row |
| `2026-02-31` | `null` → **400** | **500** + row |
| `0000-00-00` | `null` → **400** | **500** + row |
| `2026/02/30` | `null` → **400** | — |

Same inputs, two routes, opposite outcomes, and the only difference is the guard `CLAUDE.md`
mandates. Q-496 is not a theoretical gap — the correct behaviour is already demonstrated one
directory away.

## Q-497 — a 31-day range that passes every guard never terminates

The loop is:

```ts
for (let d = start; d <= end; d = shiftDateStr(d, 1)) {
  days.push(await buildDayAudit({ repo, userId, date: d, tz }))
}
```

`d` and `end` are **strings**, so `<=` is lexicographic. `shiftDateStr` builds its output from
`getUTCFullYear()` with no width padding, so **one day after `9999-12-31` is `10000-01-01`** — five
digits. And `'10000-01-01' <= '9999-12-31'` is **true**, because `'1' < '9'`.

Every guard passes on the way in:

- `normalizeDateParamIso('9999-12-01')` → valid
- `end < start` → false
- `daysBetweenDateStrs + 1` → **31**, exactly at `MAX_RANGE_DAYS`

**Measured**, replicating the loop verbatim:

```
span check: 31 (MAX_RANGE_DAYS = 31 -> passes)
lexicographic: '10000-01-01' <= '9999-12-31' is true
  iter 30 d = 9999-12-30
  iter 31 d = 9999-12-31
  iter 32 d = 10000-01-01     <-- should have exited here
  iter 33 d = 10000-01-02
  ...still looping at iteration 5000 d = 10013-08-08
RESULT: loop ran 5000 iterations for a 31-day range
CONTROL (2026-08-01..31): 31 iterations — terminates correctly
```

It does not exit until the year reaches five digits starting with `9` — roughly **80,000 years**, or
~29 million iterations. Each iteration is a `buildDayAudit`, which the route's own comment puts at
**~12 queries**, against a `max: 10` pool.

**The irony is in the comment directly above the loop.** It explains that the days are run
sequentially rather than concurrently because *"fanning a 31-day range out concurrently would starve
the rest of the app (the failure mode that took production down in session 165)"*. The sequential
loop avoids that — and then never stops.

## The sibling has it too, and that one writes

Three loops in the repo use `shiftDateStr` as the increment:

| Site | Same defect? |
|---|---|
| `app/api/admin/day-review/route.ts:118` | ❌ **yes** — read-only |
| `app/api/admin/backfill-derived-scores/route.ts:80` | ❌ **yes** — identical guards, identical loop, and **it writes** (`dryRun=false` commits) |
| `lib/health/energy-balance-service.ts:152` | ✅ safe — `windowStart` is derived by shifting *back* from the user's today, so it cannot reach the year-9999 boundary |

`backfill-derived-scores` carries the same `MAX_RANGE_DAYS = 31` and the same `end < start` guard, so
it is reachable identically — and a non-terminating loop there is not just a hang, it is an unbounded
write.

## Severity

**Medium.** Both routes require admin — a session cookie or the `ADMIN_EXPORT_SECRET` bearer — so this
is not an unauthenticated vector. It is a footgun: an admin (or a calibration script) supplying a date
in year 9999 hangs the request, saturates a `max: 10` pool with ~12 queries per iteration forever, and
on the backfill route writes as it goes. Nothing recovers it but a process restart.

Weigh it as "one mistyped year takes the app down", not as an attack.

## The fix

Not a bound on the year — that treats the symptom. **Compare dates numerically, or pad the year**, so
the ordering that the loop's termination depends on cannot invert. `shiftDateStr` is the single place
that produces the malformed value: padding its year to 4+ digits (`padStart(4,'0')` already exists for
month and day, the year is the one field without it) fixes both call sites at once, which is the
one-formula-one-place answer.

A cheap belt-and-braces addition: an iteration cap equal to `MAX_RANGE_DAYS` in both loops, so a
future ordering bug degrades to a truncated response instead of a hang.

## Not exercised

The loop was reproduced verbatim in isolation rather than by hitting the route — deliberately, because
driving it against the running server is the hang itself and the point was already proven. The route's
auth, GET-only and fail-closed claims were verified by reading the code against `CLAUDE.md`'s
statements, not by driving the bearer path. No device, no production.
