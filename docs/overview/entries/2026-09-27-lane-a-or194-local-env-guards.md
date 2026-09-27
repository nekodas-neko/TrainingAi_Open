# 2026-09-27 — OR-194: the three guards a persistent local agent needs

Written from inside the first local Lane A session, on the owner's Windows machine, so each guard
answers something that actually happened today.

## What shipped

- **③ `pnpm db:rebuild`** (`scripts/local-db/rebuild.js`): drops and recreates the database named
  by `LOCAL_DATABASE_URL`, runs `migrate.js`, loads `seed.sql`. It is cross-platform, because
  `setup.sh` needs `initdb` and `su` and cannot run on Windows. It refuses non-local hosts, the
  `postgres` database and non-snake_case names, and it never touches `.env.local`. Run for real:
  `trainingai_lane_a` rebuilt with all 287 migrations and the seed; a Railway URL refused, exit 1.
- **② `setup.sh`** takes `LOCAL_DB_PORT` / `LOCAL_DB_NAME` / `LOCAL_PGDATA` / `LOCAL_PGLOG`, with the
  cloud defaults unchanged. It no longer overwrites a non-local `DATABASE_URL` in `.env.local`.
  **That was a live hazard the entry did not name**: the owner's `.env.local` holds two Railway URLs,
  and the old `sed` replaced every `DATABASE_URL=` line. On Windows it died at `su` before reaching
  them. On Linux or WSL it would not have.
- **① One worktree per lane**, as a written procedure in `docs/local-agent-environment.md`, with the
  Docker and port facts from this machine: 5433 belongs to another project's Postgres.
- **`check-test-typecheck.js` runs on Windows again.** It spawned `npx.cmd`, which Node's
  CVE-2024-27980 fix turned into `EINVAL` without a shell. It now runs `typescript/bin/tsc` with
  `process.execPath`: no `npx`, no `.cmd`, no shell. Same result: 316 errors across 87 files, at
  baseline.
- **Filed `LA-163`**: nine tests in six files fail on Windows and pass on CI (paths, timezone, one
  timeout).

`OR-194` leaves the queue. `OR-195` (move Lane A local) named it as `Needs`, so that decision is now
the owner's to take.

## Verification

- `rebuild.test.ts`: five cases, including the socket URL `setup.sh` writes, which `new URL()` rejects
  outright. The first draft missed that; the test caught it.
- The `setup.sh` guard was checked against five URL shapes: Railway, socket, localhost, `[::1]` and
  a lookalike `1host.example`.

## Not exercised

`setup.sh` itself end to end: it needs a Linux box with `initdb`. Only its syntax (`bash -n`) and
its env-file guard were run.
