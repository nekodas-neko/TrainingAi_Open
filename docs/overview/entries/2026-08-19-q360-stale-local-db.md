# 2026-08-19 — Q-360 retired: the seed was never the problem, the local database was stale

**Branch:** `docs/q360-stale-local-db` · Implementation Lane A · docs-only.

## What Q-360 claimed

That `e2e/goal-invalidation.spec.ts` fails because *"the local database's most recent row carrying a
`steps` value is 2026-08-17"* while the assertion needs today's, and that the fix is to **make the
seed relative to the run date** rather than use literal dates.

## What is actually true

**The seed has been relative since the repository's first commit.** `scripts/local-db/seed.sql`
declares `today date := (now() AT TIME ZONE 'Australia/Brisbane')::date` and seeds body metrics as
`today - d` for `d IN 0..13` — so a fresh seed always carries a steps value for today. The
recommended fix was already implemented before the entry was written, and applying it would have
changed nothing.

More than that: the seed **already carries a comment naming this exact spec**, explaining that using
the Postgres server's `current_date` (UTC in CI) instead of the user's Brisbane date *"made
`e2e/goal-invalidation.spec.ts` fail for ten hours of every day"*. That was a real bug, it was
diagnosed correctly, and it was fixed. Q-360 rediscovered its symptom after the cure.

**The actual cause is a stale local database.** `scripts/local-db/setup.sh` does not re-seed when the
`users` table is non-empty — documented in `CLAUDE.md` as *"fully idempotent and won't re-seed"*,
which is the desired behaviour and not a defect. But a database seeded on the 17th keeps rows
relative to **the 17th**, forever. Two days later its newest steps row is two days old, which is
exactly the observation Q-360 recorded.

**That also answers the question the entry flagged as "the first thing to establish":** why green in
CI and red locally. CI provisions a fresh Postgres for every run, so it always seeds relative to the
run date and always has today's steps. A long-lived local database never does. There is no
difference in seeding logic between the two — only in age.

## Verified, not reasoned

`e2e/goal-invalidation.spec.ts` was run against current `main` with a database seeded today:
**3 passed**, including the specific case *"a steps-goal edit reaches Health without a reload"* that
the entry named. The newest `body_metrics` row with a non-null `steps` is today's date.

## What this leaves

Nothing to build, so the entry is removed rather than implemented — per the backlog's own rule that a
stale premise gets reconciled instead of forced. The durable lesson goes into `CLAUDE.md` beside the
idempotent-seed note it belongs to: **a local database that has been around for a few days holds
history that ends a few days ago, and a test asserting on "today" will fail against it while passing
in CI.** `pnpm db:local` will not fix that on its own — the cluster has to be dropped and re-seeded.

That shape is worth naming because it trains exactly the wrong reflex: a red local run that is green
in CI reads as CI being unreliable, when it is the local fixture that has aged out.
