# 2026-09-09 — the Oura-BLE reads and the gate in front of them (PS-39, 40 → 36)

**Branch:** `test/oura-ble-sample-routes` · **No product change.**

15 cases over `oura-ble/samples/summary`, `oura-ble/samples/raw`, `oura-ble/db-stats` and
`oura-ble/freshness`. They share one gate and differ in exactly the ways that gate matters, which is
what makes them a batch rather than four thin files.

## The gate is most of the value

Three are admin-gated and **`freshness` deliberately is not** — it is a cheap local read the app
fires on open to decide whether syncing is worth it, so a `requireAdmin` there would break start-up
for any non-admin, while its absence on the other three would expose a raw frame dump. The
asymmetry is the design, and both halves are asserted.

Two properties inside `requireAdmin` carry real history:

- **The JWT's `isAdmin` claim is ignored on purpose.** It is stamped at login and can be 30 days
  stale, so a revoked admin still holds a token saying otherwise. The fixture sets the claim to
  **true** while the row says false — with both false the route could read either and answer
  correctly, and the rule would go untested.
- **A failed admin CHECK is 503, not 403 (Q-548).** The check hits the database, so a bare catch
  turns an outage into `Forbidden` — the one status nobody retries or escalates. During the
  2026-08-18 volume incident several minutes went into checking credentials while the dashboard
  already said the service was offline.

A third case runs the opposite direction — an admin whose token says nothing at all is admitted —
because without it a route that always answered 403 would pass the stale-claim case.

## The parameter parsing

`samples/raw` takes hex tags, and `10` must mean sixteen: decimal parsing would return the wrong
frames and the dump would read as empty for a tag with plenty of rows. Malformed entries (`zz`), an
out-of-range one (`1ff` is 511, past a one-byte tag) and a negative are each dropped while the
survivors go through, so one bad entry does not discard the request. The page size is clamped at
both ends and falls back when unreadable — including `?limit=0`, which is falsy and therefore takes
the default rather than flooring to 1.

**One behaviour pinned rather than endorsed:** `?tags=zz` — every tag malformed — sends an **empty**
list rather than falling back to the default or refusing, so the dump reads as "nothing recorded",
which is indistinguishable from a ring that is not syncing. Recorded in the test with that
reasoning; not filed as a backlog entry, because this is an admin-only debugging surface where the
person reading the output typed the query.

## Mutation pass

**13 of 14 caught**, including trusting the stale claim, collapsing Q-548's 503 into a 403, decimal
tag parsing, both page-size clamps, and each of the three admin gates removed individually. The
survivor is an equivalent mutant planted as a control — a no-op TypeScript cast.

## Not exercised

The repository is mocked throughout, so no database and no ring: what is pinned is the gate and the
arguments that reach the repository, not the archival queries themselves. Web/Node only — no device,
no native, safe-area, gesture or notification surface.
