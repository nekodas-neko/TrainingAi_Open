# Running an agent locally — the three guards, and what a Windows machine adds

A cloud session gets a fresh clone and a database built from migrations every time. A local session
keeps both between runs, which buys wall-clock and capability (Lane A can build the Kotlin it owns)
and loses those two guarantees. OR-194 put three guards back. This file is the procedure.
It was written from the first local Lane A session (2026-09-27), on the owner's Windows machine.

## ① One working copy per agent

Two agents in one checkout stomp each other: a `git checkout` with a dirty tree carries files across,
and they ship inside an unrelated PR (#1140, 2026-08-08). Give each lane its own worktree:

```bash
git fetch origin main
git worktree add ../TrainingAi_Open-lane-a origin/main
```

Start the agent in that directory. Never share one between lanes, and never run a lane from the
owner's own working copy.

**The same applies to ONE agent running two things at once.** A background suite reads the checkout
as it goes, so a `git checkout` mid-run makes it test half of each branch. Measured 2026-09-27: a
test file loaded from one branch ran against `date-utils.ts` from another and failed on a correct
change. Run the suite in its own worktree, or do not switch branches until it exits.

## ② One database per agent

`setup.sh` takes `LOCAL_DB_PORT`, `LOCAL_DB_NAME`, `LOCAL_PGDATA` and `LOCAL_PGLOG`, defaulting to the
cloud container's values. On a machine where Postgres runs some other way (Docker, a native install),
skip `setup.sh` and give each lane its own database name on the same server, for example
`trainingai_lane_a` and `trainingai_lane_b`.

**Check what already owns the port before assuming it is yours.** On the owner's machine, 5433 is
another project's Postgres container (`finyte-postgres`). TrainingAI's runs in its own container:

```bash
docker run -d --name trainingai-dev-postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=trainingai_dev -p 127.0.0.1:5434:5432 postgres:16
```

## ③ Rebuild from migrations at session start

```bash
LOCAL_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/trainingai_lane_a pnpm db:rebuild
```

`scripts/local-db/rebuild.js` drops that database, recreates it, runs `migrate.js` and loads
`seed.sql`. It refuses any host that is not local, the `postgres` maintenance database, and a name
that is not plain snake_case. It never touches `.env.local`. This replaces the guarantee a fresh
clone gave: `generate-claude-ro-views.js` writes whatever columns it finds into a committed file,
so a database with hand-applied changes would publish them.

## ④ Keep the lane's environment — do not rebuild it per PR

The owner's goal (2026-09-28): Lane A runs locally and keeps churning, with a test environment that
survives from one PR to the next. The shape that gives it:

- **One permanent worktree per lane, and branches switch inside it.** Lane A's is
  `D:/Projects/TrainingAi_Open-lane-a` (`git worktree add --detach ../TrainingAi_Open-lane-a origin/main`).
  A new PR is a `git checkout -b <branch> origin/main` in that directory, **not** a new worktree.
  A throwaway worktree is for one job only, such as resolving a conflict on another branch while a
  suite runs, and it has no `node_modules`.
- **`node_modules` is installed once.** `pnpm install --frozen-lockfile --prefer-offline` hard-links
  from the shared store. The first install of the Lane A worktree took **12.5 s**, and after that only
  a lockfile change needs a re-run.
- **The worktree's own `.env.local` has no production database in it.** It is the owner's file with
  every `DATABASE_URL`/`LOCAL_DATABASE_URL`/`CLAUDE_DB_READONLY_URL` line removed and the lane
  database written in instead, with `DATABASE_SSL=false`. A command run there with no override
  reaches `trainingai_lane_a`, never Railway, and the per-command overrides below stop being
  load-bearing.
- **One database per lane on the Docker server**, `trainingai_lane_a` on 5434. `pnpm db:rebuild`
  resets it to migrations plus the seed. `pnpm db:snapshot` loads the owner's production rows into
  it for prod-shaped testing:

  ```bash
  LOCAL_DB_PORT=5434 DATABASE_URL=postgresql://postgres:postgres@localhost:5434/trainingai_lane_a \
  SNAPSHOT_URL='https://trainingai-production.up.railway.app/api/admin/db-snapshot?bulk=0' \
  ADMIN_SNAPSHOT_SECRET=<from .env.local> node scripts/local-db/snapshot.js
  ```

  It holds the owner's rows only (the `claude_ro` scope) and omits the four bulk tables unless
  `bulk=<days>` asks for them. It refuses a stream the server reports as failed, and it rolls back
  on any count mismatch, so a bad load leaves the database as it was. **Rebuild before a migration
  rehearsal, and snapshot when a bug needs real data.** The fresh seed is exactly what hides drifted
  production rows.

## `.env.local` on a developer machine holds production URLs

Both `DATABASE_URL` lines in the owner's `.env.local` point at Railway, and it sets
`DATABASE_SSL=true`. A process env var beats `.env.local`, so pass both explicitly for every run:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/trainingai_lane_a DATABASE_SSL=false pnpm dev
```

Unsetting `DATABASE_SSL` in the shell is not enough, because `.env.local`'s `true` then applies.
`setup.sh` used to overwrite every `DATABASE_URL=` line there. It now leaves a non-local one alone.

## Windows

- **`pnpm build` does not run under `cmd`**: the script's `NODE_OPTIONS=…` prefix is POSIX. Run
  `node scripts/build-rollup-worker.mjs` then `next build`, with `NODE_OPTIONS` exported.
- **Stopping a background `next dev` leaves its node child holding :3000.** Find the PID with
  `netstat -ano` and kill it.
- **`pnpm start` will not boot without valid storage keys.** The instrumentation hook fails closed in
  production mode on `SignatureDoesNotMatch (403)`. That is deliberate, so do not work around it.
- **Do not run `pnpm lint` (or anything that reads the source tree) while the full suite runs.**
  `check-comment-blindness.test.ts` writes fixtures into real files such as
  `components/workout/set-card.tsx` and restores them afterwards. A lint in that window reports a
  parsing error in a file nobody touched. Measured 2026-09-27; lint on its own was clean.
- **The whole suite passes on Windows** since LA-163 (2026-09-28). Nine tests in six files used to
  fail here and pass on CI: four compared OS paths against `/` literals, one read a `DATE` column as
  an instant (node runs in the machine's zone), and one timed out on slow process spawns (LA-167).
  A new failure that only appears locally is worth one look at those three shapes first.
