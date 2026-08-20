# 2026-08-20 — CI could not catch a non-idempotent migration, and the first fix couldn't either (LA-13)

**Branch:** `feat/migration-replay-check` · **Lane A** · closes **LA-13**

## The gap

`Migration Check` runs `migrate.js` against a **fresh** database — the one case where a
non-idempotent migration cannot fail, because nothing is there to collide with. PS-3's four hid for
months for exactly that reason, and the worst of them, `157`, was a `CREATE TABLE` followed by ten
`ADD COLUMN`s where the first collision aborted every statement behind it. That shape is how the local
SQLite store has twice been left silently dead on Android. The Postgres side had no equivalent guard.

The job now replays every migration against the schema it just built: truncate `schema_migrations`,
run again with `--replay`. The truncate lives in the workflow rather than inside the runner, so the
destructive step is visible at its call site.

## The mistake worth reading, because it nearly shipped

The first version was green with `157` deliberately broken. **The check could not catch the thing it
exists for.**

`migrate.js` classifies "already there" SQLSTATEs — `42P07`, `42710`, `23505` — as benign and steps
over them, which is correct on an ordinary run and is what `ensureSchema()` does. Under replay it is
exactly backwards: **an "already there" error means the statement THREW rather than being a no-op,
which is the definition of non-idempotent.** A genuinely idempotent migration re-applies with no error
at all.

So under `--replay` those codes are the failure, not the pass. Nothing else about the classifier
changed, and the ordinary path is untouched.

I would not have found this by reading the diff. The acceptance criterion said *demonstrated, not
argued*, and breaking a migration on purpose is what demonstrated it.

## Demonstrated, in both directions, on all three collision shapes

| | replay |
|---|---|
| all 206 migrations as they stand | **GREEN** — 205 applied, `001` exempt |
| `157` reverted to a bare `CREATE TABLE` (42P07) | **RED** — *"NOT IDEMPOTENT 157_scale_ble.sql"* |
| `054` reverted to a bare `ADD CONSTRAINT` (42710) | **RED** |
| `082` reverted to an unguarded seed (23505) | **RED** |
| all three restored | **GREEN** |
| ordinary (non-replay) run, dev database | unchanged — 206 skipped, 0 failed |

## The check proves it did the work, because green would not have

A replay that replays nothing is the silent no-op this would most likely decay into: if the caller's
`TRUNCATE` stops taking effect, every file reads as already-recorded, the run reports `applied 0` and
exits **0**. Green, having verified nothing — and indistinguishable in a green tick from 205 clean
replays.

So `--replay` fails when it re-ran nothing, naming the cause. Verified both ways: replaying without
truncating is **RED** with *"REPLAY VERIFIED NOTHING"*, and with the truncate it is **GREEN**.

This exists because I went to read the CI log to confirm the step had really replayed, and could not
easily get at the line. Needing to read a log to know whether a check checked anything is the defect;
the check should say so itself.

## The one exemption, by name and with its reason

`001_initial.sql` creates `cardio_sessions` with a `user_id` FK, and `002` renamed the column it
references — so replaying `001` onto a modern schema fails with *"foreign key constraint
cardio_sessions_user_id_fkey cannot be implemented"*. That is **incoherent rather than
non-idempotent**, and only reachable by truncating the ledger by hand; nothing on the real migration
path re-runs it.

It is exempted in a `Map` that carries the reason as its value, and the run **prints every exemption
it took** — a silent skip in a check like this is how the check stops meaning anything.

## Also in this PR

**LA-16's queue position contradicted its own body.** I filed it at the top of READY while its last
bullet says *"lower priority than Q-424 was: these fire far less often."* Position is what the tool
reads, so it has been moved below LA-17.

**And LA-16's premise was overstated — by me, this morning.** It claimed all six remaining ratchets
count occurrences rather than lines, so the Q-424 helper would not transfer. Reading them says
otherwise: **`check-component-size` is a line-count ratchet**, identical in shape to the docs one, and
is the cheapest of the six. The entry now names what each script actually does, including the one I
have not read.

## Not exercised

No route, no schema, no device surface. **The CI half runs for the first time on this PR** — the
`psql` truncate assumes the client is on the runner (it is, on `ubuntu-latest`) and that the service
container accepts a TCP connection as `postgres`, which the job's existing step already relies on. If
`Migration Check` goes red here, read that step first.
