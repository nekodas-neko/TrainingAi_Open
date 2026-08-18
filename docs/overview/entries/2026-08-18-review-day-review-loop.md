# 2026-08-18 — Review sweep 31: the admin date-range routes, and a loop that does not terminate

**Agent:** Review 📖 · **Branch:** `review/day-review-loop` · **Docs-only.** Filed **Q-497**.

Sweep 30's lesson was that *"needs configuration"* had kept a surface untested for 29 sweeps and was
never a real barrier. `admin/day-review` is the **other** secret-gated route (`ADMIN_EXPORT_SECRET`),
so this sweep applied that lesson immediately rather than filing it as a suggestion for a successor.

**All three of `CLAUDE.md`'s claims about the route hold**, checked rather than assumed: `GET` is the
only export; the bearer path rejects before the compare when either `ADMIN_EXPORT_SECRET` or the user
id is unset; and `requireAdmin(exportUserId)` runs on the token path, so the token widens *transport*
and never authority. The route is otherwise carefully built — `end < start` guarded, `MAX_RANGE_DAYS`
bounding the fan-out, and a sequential day loop with a comment citing the session-165 pool exhaustion.

**Q-497 — and it is that same loop.** `for (let d = start; d <= end; d = shiftDateStr(d, 1))` compares
**strings**. `shiftDateStr` builds its year from `getUTCFullYear()` with no width padding — month and
day both get `padStart(2,'0')`, the year is the one field without it — so one day after `9999-12-31`
is `10000-01-01`, and `'10000-01-01' <= '9999-12-31'` is **true** because `'1' < '9'`.

`from=9999-12-01&to=9999-12-31` passes `normalizeDateParamIso`, passes `end < start`, and spans
**exactly 31, the `MAX_RANGE_DAYS` ceiling**. Reproducing the loop verbatim: iteration 32 reaches
`10000-01-01` where it should have exited, and it was still looping at iteration 5000 at year 10013;
a control range terminates at 31. Each iteration is a `buildDayAudit` — ~12 queries by the route's own
comment — against a `max: 10` pool.

The irony is the comment directly above it, which explains the days run sequentially rather than
concurrently because fanning out *"would starve the rest of the app (the failure mode that took
production down in session 165)"*. The sequential loop avoids that, and then never stops.

**Two sites, and the second one writes.** Three loops in the repo use `shiftDateStr` as the increment.
`admin/backfill-derived-scores:80` has the identical loop and identical guards, and `dryRun=false`
commits — so there it is an unbounded write, not just a hang. `energy-balance-service.ts:152` is safe:
its start is derived by shifting *back* from the user's today, so it cannot reach the boundary.

**Severity medium — both routes are admin-only**, so this is a footgun rather than an attack vector:
one mistyped year hangs the request and saturates the pool until a restart. **The fix is not a year
bound** — pad the year in `shiftDateStr`, the single place that produces the malformed value, which
fixes both call sites at once.

**A side result worth keeping: this corroborates Q-496 directly.** `2026-13-45`, `2026-02-31` and
`0000-00-00` return **400** here via `normalizeDateParamIso` and **500** on `health-connect/ingest`
via its raw regex. Same inputs, opposite outcomes, one directory apart — the correct behaviour is
already demonstrated next door to the gap.

**Not exercised:** the loop was reproduced verbatim in isolation rather than by hitting the route,
deliberately — driving it against a running server *is* the hang, and the point was already proven.
The auth claims were verified by reading the code against `CLAUDE.md`'s statements, not by driving the
bearer path. No device, no production.
