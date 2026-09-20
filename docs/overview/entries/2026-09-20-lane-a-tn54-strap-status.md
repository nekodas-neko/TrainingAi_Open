# 2026-09-20 — TN-54: the strap kept its own diagnosis in memory

**Branch:** `lane-a/tn54-strap-status` · **Lane A** · sixth item of the session, and the first from
READY rather than KEEP — TN-54 was filed at 20:23 and un-gated by #1353 twenty minutes later.

## What was wrong

The owner wore the strap overnight and asked whether it recorded what was needed. It had not, and
neither he nor the session could say why.

Measured: across `rr_intervals` **and** `oura_heartrate` the last chest-strap sample of any kind was
**2026-09-15 23:11 UTC** — five days, both tables, zero rows. The same night the ring wrote **455 HR
samples** through the same phone, app, network and `/api/hr-ingest`, so the ingest path was healthy
and only the strap contributed nothing.

**And nothing server-side recorded why.** `PolarStrapService` knew the whole story and kept it in
memory: `battery` is a `private var` written once per connection, the give-up path (`stopSelf()`
after six consecutive failures) logs *"strap not reachable"* to `onLog`, and `status()` — which
already carries state, battery, failure count and contact — goes to the **Capacitor event sink**.
That is the WebView, live. So a strap that died, ran flat, or never connected was indistinguishable
from one that was not worn, from every surface except having the app open at the moment it happened.

Ring battery readings persisted: **11,758**. Strap: **0**.

## What shipped

**Migration 278, `strap_status`** — one row per connection attempt or state change, shaped on
`oura_ble_battery_poll` (the reason the ring's 11,758 exist). `recorded_at` is server-stamped
because every row describes a state the service is in as it posts; **`last_sample_at` is the
exception** and comes from the device, because it is the figure that answers *did last night count*.

`state` is text, not an enum. The states belong to the service, and a state the table cannot
describe is exactly the failure it exists to catch.

**`POST`/`GET /api/strap-status`** — session-authenticated, matching `/api/hr-ingest`, which is the
path the strap's own poster already uses. Deliberately **not** admin-gated like
`oura-ble/battery-poll`: a status this route rejects is a status nobody ever sees, which is the
defect. `.strict()` Zod, structural bounds on the timestamp (the `hr-ingest` lesson — an unbounded
epoch makes `new Date()` Invalid and 500s the driver).

**`PolarStrapService` posts its own status.** Hooked to `emitStatus()` rather than to individual
call sites, because every transition worth recording already calls it — connect, ready, failure,
battery, give-up, and the final `onDestroy` — and a new transition that forgets to post is the
failure mode this removes. It is **not** on the sample path, so it cannot become per-beat traffic.
Posts on a change of the fields that explain reachability, plus a 15-minute heartbeat so hours of
healthy connection read as evidence rather than as silence.

## The part that needed more than plumbing

The give-up is the one event that must reach the server, and it runs `stopSelf()` → `onDestroy()` →
**`ingest.shutdownNow()`**, which cancels queued tasks that have not started. The final status and
the final flush are queued three lines above it. So the most important row was the one most likely
to be thrown away.

`onDestroy` now drains gracefully with a bounded 3-second wait before falling back to
`shutdownNow()`. Bounded, so a wedged POST cannot hold the service open.

## Verification

**Live against the real route, repository and Postgres** — not mocks:

| | result |
|---|---|
| before any post: has this device ever reported? | **`latest: null`** |
| give-up (state, battery, last sample, 6 failures) | **200**, row stored |
| minimal status — state only | **200** |
| a key no column has | **400** |
| battery 140 | **400** |

**Mutation pass — 3 mutations, each caught by its intended test:**

| mutation | caught by |
|---|---|
| drop `.strict()` from the body schema | `refuses a key no column has` |
| drop `lastSampleAt` on the write path | `stores the give-up the service used to only log` |
| `getLatestStrapStatus` returns the oldest row | `returns the newest row, not the first` |

The third matters most: a stale `connected` is precisely the reading that reassured the owner on
2026-09-19, so a "latest" that is not the latest reproduces the bug inside the fix.

**Equivalent control, green 13/13:** the parsed binding renamed throughout the route.

`Ran 75 of 75` custom rules — after two the gate caught and I fixed: a zero-argument `vi.fn` with
indexed calls (LB-62, would have failed the Build job's typecheck after merge), and the backlog's
next-free-migration pointer, which I had not advanced.

## CI caught two things the local suite could not — and one of them is a documented claim being wrong

`Tests` went red on a branch whose local suite read 956 files / 9061 tests / 0 failed:

- `db-snapshot-integration.test.ts` — *"Snapshot drift: table strap_status has no claude_ro view"*
- `claude-ro-readonly-role.test.ts` — *"expected 96 to be 97"*

`claude_ro` is default-deny, so a NEW table is unreadable through `/api/admin/db-query` until the
views are rebuilt. Migration **279** is the regenerated twin; diffed against 277 it adds exactly one
view and nothing else, and the owner's id appears **zero** times (Q-456).

**The interesting half is why the local suite missed it.** Migration 277's header — and the Lane A
routine — say these two tests *"skip locally even with a DATABASE_URL, because local dev creates no
`claude_readonly` role"*, i.e. that CI is structurally the only place they can fire. **That is
wrong.** `claude-ro-readonly-role.test.ts` provisions the role itself. What it needs is a **TCP**
`DATABASE_URL`: it reconnects as `claude_readonly` by rewriting the URL's credentials, and on the
Unix-socket URL `scripts/local-db/setup.sh` writes, that rewrite silently reconnects as the
superuser — so the file skips loudly instead of reporting twenty false failures. Its own header
says so, and nobody had read it against the claim.

Measured, with 279 applied: `DATABASE_URL='postgresql://postgres:postgres@localhost:5433/…'` →
**2 files, 27 tests, all passed, none skipped.** So this class IS catchable before pushing, one URL
form away. Written into CLAUDE.md as a rule for the next migration that adds a table or column,
because the belief that it was CI-only is what made a red run feel unavoidable.

## Not exercised — and one of these is load-bearing

- **The Kotlin COMPILES, and I was wrong to say CI could not check it.** I claimed CI has no
  Kotlin step; it has an `Android (Kotlin tests + debug APK)` job, it ran on this PR and it
  **passed**, so the native half builds and its unit tests are green. What is still unexercised is
  the only thing that matters here: **no part of it has RUN against a strap.** The `onDestroy`
  drain in particular is the piece I am least willing to call proven — compiling proves the
  executor call is well-formed, not that the give-up row survives a real `stopSelf()`. The device
  check is owed and is in the entry's `Keep:`.
- **Nothing renders this yet.** The Devices screen still shows *"Connected"* with no battery figure
  and no last-sample time — the surface that actively reassured the owner. That is the Lane B half
  and it is what makes this visible to a human; until it lands, the data exists and nobody sees it.
- **No changelog entry or version bump**, deliberately: nothing here is user-visible yet. A
  changelog line would describe a screen that does not exist.

## What this does NOT fix, stated plainly

The service still stops itself after six failures and nothing restarts it until the app is
launched. **Recording that is not fixing it.** What changes is that the next five-day gap is visible
the next morning instead of never — which is what PS-44's seven-night window actually needs, since
it must not count a night until the night is in the table.

The entry also carries a finding worth not re-litigating: **an accurate battery percentage is not
achievable.** The H10 runs a CR2025 with a near-flat discharge curve, and the service's own comment
already says a dying cell presents as flaky connections long before it presents as a dead strap. A
constant 100% is the cell behaving normally. `last_sample_at` and connection reliability move days
before the percentage does, which is why they are what this table records.
