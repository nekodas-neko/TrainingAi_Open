# 🚧 Implementation Agent (A) — baton

> **Successor sessions are titled `🚧 Implementation Agent (A) 🟢`** — exactly, emoji included. The title
> is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a
> perfect baton.

**Updated:** 2026-09-01 · **By:** the thirteenth session to run as Lane A · **Next ID:** `LA-51`
(`grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line)
**Migrations:** directory head **253**, next free **254** — claim against open PRs too, not just the
directory. Local SQLite **v33**.

## Now

**Ten PRs merged this session:** #747 (BF-1 blood-panel storage), #750 (BF-97 scanned-meal groups),
#751 (a compaction chore), #752 (BF-59 phase-aware volume targets), #754 (this baton), #755 (LB-44),
#756 (BF-69 planned), #760 (BF-64 re-classified), #762 (LA-52 filed). Start with
`node scripts/next-item.js --lane A` and read its real output.

**⚠ The startable Lane A queue is THINNER than READY's count suggests, and this is the thing to know
first.** Scanned 2026-09-01: of the top seven, **BF-69** was planned this session so its build is a
later session's by protocol, **BF-77** is owner-gated planning, **LB-18** is Lane B by name,
**LA-47** says outright that its own proposed split *"does not compile"*, **BF-4** needs one photo
scan from the owner, **LA-48** is now parked behind LA-52, and **Q-535**'s remaining half is Lane
B's. From position 8 the list is the Tuning calibration block, which is owner-gated. **That is not a
shortage of work — it is what a scan says today. Do not manufacture an item, and do not start a
gated one to look busy.**

**Two entries carry a `Keep:` a successor must read before touching the area:**

- **BF-59 introduced a live inconsistency, deliberately.** The Training card's weekly target is
  derived from `volumeLandmarks` scaled by the week's phase mix; **`signals.ts` still builds the AI's
  `volumeBudgetPerMuscleGroup` from the stored `program_volume_targets` number**, which is the flat
  14/10 binary the card stopped reading. Before the change both were wrong together; now only the
  prescription is. It needs a device pass, because it changes prescribed sets.
- **BF-97 writes a group nothing renders yet.** `food_logs.meal_group_name` is written by all three
  paths and `groupDiaryEntries` still requires a `savedMealId`, so a scan draws as before. The safe
  half of the split, not an oversight.

**BF-1's storage half shipped; the extraction route and the consumers are still Lane A's.**
`latestAnalytes` was written for the consumers and **removed again** — `check-dead-repo-methods`
rejects a method with no caller. Bring it back in the same PR as its reader.

**Three entries were re-classified or re-scoped rather than built, and LA-53 proposes catching the
mechanical case.** An entry whose Lane A half has shipped keeps heading Lane A's list, because
`next-item.js` reads the `Lane:` field and nothing re-reads it when the remaining work moves lanes.

## The habit that has now paid on every entry it has been applied to

**Re-verify an entry's premise against current `main` or production before building it, and write
down what you checked.** This session it paid four times in four entries:

- **BF-59** claimed the stored targets were a flat binary and the goal multiplier was ignored. One
  `claude_ro` query confirmed both (15 rows, all 14 or 10; program is `powerbuilding` = ×0.8) — and a
  second found the thing the entry could not have known mattered: the sessions span **three phases at
  once**, which is what makes "this week's phase" unstorable and reshaped the whole fix.
- **BF-59's own corrective-migration proposal was wrong** and the measurement is why: a SQL migration
  would need the landmark table expressed in SQL, i.e. a second copy of the formula — the exact class
  the entry is filed under. Deriving at read time was the answer instead.
- **BF-97** asked whether the scan write path could mint a group. Reading it showed the *decision* the
  entry framed as open (where the name comes from) was already settled by the diary rule's own
  docstring.
- **The analyte table looked complete and was six short.** `ANALYTE_KEYS` named 52 of the report's 58;
  the other six slugged to exactly the right key **by accident**. Found only by counting the panel to
  correct a number in prose.

**The general shape: a hand-copied list can only ever agree with itself.** Both fixes this session
replaced one — the analyte coverage test now reads its labels out of the report, and BF-59's target
reads the landmark table rather than a copy seeded from it.

## Traps this session walked into, so you do not

- **`pnpm check:rules | tail` swallows the exit code.** A gate failure was masked by an `&&` chain and
  a PR went out with *No shared test-user UUIDs* red. **Redirect to a file, echo `$?`, then read the
  file** — never pipe the gate into anything.
- **An invalid UUID in a DB test reports as SKIPPED, not failed.** A fix for that collision used an
  11-hex-char last group; Postgres rejected it as `invalid input syntax for type uuid` and vitest
  printed **7 skipped**. The check's own message warns about this and it still happened. **Count the
  tests that RAN**, not the ones that did not fail.
- **`docs/overview/entries/` has a 250-file ceiling, and it fails whichever branch crosses it** —
  here a feature PR whose only offence was adding its own journal entry. The remedy is the compaction
  chore in `entries/README.md`, not a ceiling raise. Folding the 23 uncited entries took it to 227;
  `check-doc-links` passed first run against 935 files with the README's four link rules applied
  mechanically. **Budget half an hour for it if the count is near 250 when you start.**
- **Running the suite on a branch that lacks the newest `claude_ro` views migration CLOBBERS the local
  views**, and `migrate.js` will not restore them — the file is already recorded as applied, so it is
  skipped forever. That is the "editing an applied migration" trap in its local form. Symptom:
  `db-snapshot-integration` fails with *Snapshot drift: column X is in neither its claude_ro view nor
  _meta_withheld_columns* while the migration file plainly contains the column. Fix:
  `psql "$DATABASE_URL" -f lib/data/postgres/migrations/<N>_claude_ro_views_*.sql`.
- **`psql` is NOT blocked** — an earlier baton said the command classifier refuses it. It ran fine all
  session, against `postgresql://postgres:postgres@localhost:5433/trainingai_dev`. **`tsx` has no
  `.bin` shim** but is installed: `node node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs`.
- **`DATABASE_URL` is EMPTY in a fresh shell**, so `npx vitest run` silently skips every DB test —
  1,013 of them, reported as "skipped" beside a green summary. Export the TCP form yourself before
  believing a DB-backed run.
- **A mutation that moves BOTH sides of a relative assertion survives.** Fixed by anchoring on
  something the mutation cannot move — a recomputed absolute value, or a literal the source does not
  contain (BF-59's route test stores a target of **999** and asserts the response never contains it,
  which is the only assertion that can tell *derived* from *read*).
- **Inherited and still true:** a backlog conflict is usually TWO DELETIONS — keep neither side, read
  the headings. `doc-size-baseline-history.md` is append-only, so there keeping both *is* the
  resolution. Re-derive a `.size` from the merged file (`awk 'END{print NR+1}'`), never by picking a
  side. Commit before switching branches; never `git add -A` straight after a checkout that carried
  changes.

## Standing constraints

- **The local gate is `pnpm check:rules`** — quote its `Ran N of N`, never the word "pass". **67 of
  67** on 2026-09-01. Never hardcode it; the runner reads it from `ci.yml`, which is the point.
- **The clone is depth 1.** `git fetch --deepen=50 origin main` before any `git merge origin/main`, or
  it refuses as "unrelated histories". Hit three times this session; it is not optional, and a plain
  `git fetch origin main` does **not** deepen.
- **E2E is not a required check.** The five that gate a merge are Lint, Tests, Build, Custom Rules,
  Migration Check. All five report within ~4 minutes; Tests is the slowest at ~3.5.
- **`get_check_runs` at `total_count: 0`** several minutes after a push is a stale base, not slow CI.
- **A check run that dies in seconds with no logs is GitHub Actions infrastructure**, not your diff.
  One re-run is sanctioned; a second failure is real.
- **`pnpm dev` works, and exercising the changed route on it is the merge gate.** `test@local.dev` /
  `testpass123` via `/api/auth/callback/credentials` with the CSRF token from `/api/auth/csrf`. Both
  route changes this session were driven end to end that way and both found nothing — which is the
  point: it is cheap, and it is the only thing that catches a validation or serialisation bug.
- **Nothing has run on the S25 for five sessions.** Anything touching offline-first, native,
  safe-area, gestures or notifications needs the device smoke run or an explicit Known-Issues row.

## Waiting on the owner

Do not chase these; do not start one to look busy. **Answered 2026-09-01:** BF-59's phase multipliers
— *scale the target AND say why*, accumulation 1.0 · intensification 0.8 · realisation 0.6 · deload
0.5. The scale is shipped; the "say why" is Lane B's render.

- **LA-50** — a pixel-baseline job must push commits from Actions, which needs workflow write
  permission. `Gate: owner`, and the only thing blocking that entry.
- **Add `E2E` to `main`'s required checks.** Nothing in this repository can make it required.
- **One photo scan in the app** — unblocks BF-4 entirely.
- **The Tuning calibration cluster** — owner signs off, then Lane A implements.
- **Q-388 SpO₂** — one night without the measurement sequence: a Kotlin change and a new APK.
- **Q-549 / Q-551** — Railway cost and hosting decisions.
- **The device run: 13 entries**, the owner has agreed to run the checklist as written.
- **Null the corrupt `body_comp` snapshot (2026-07-29)?** Recommended; the measurement stays in
  `body_metrics` either way.

## Claimed paths

- `scripts/lib/`, `lib/media/`, `android/…/media/`, `lib/net/safe-fetch.ts`, `app/api/admin/vacuum/`,
  `app/api/oura-ble/rekey/`, `lib/data/postgres/slices/oura-raw-{frames,pack}.ts`,
  `packages/shared/src/workout/derive-session-rpe.ts`,
  `packages/shared/src/health/workout-energy.ts` — Lane A's.
- `scripts/` sits in neither lane's path list and the rule does not decide it. Claim per PR, release
  on merge.
- `components/nutrition/meal-label-*` is **Lane B's**. BF-97's engine half touched
  `components/nutrition/food-logger-sheet.tsx` for one argument, engine-half-first per the rule; that
  claim is released.

## Findings, so they are not re-derived

*The raw-frame half lives in [`docs/oura-ble-operations.md`](../../oura-ble-operations.md) §5. Keep
it there.*

- **`program_volume_targets` is now a ROSTER, not a target.** Its `muscle_group` says which muscles a
  program trains; its `target_sets_per_week` is read by nothing the user sees. Re-seeding those
  numbers recreates the second source of truth BF-59 removed. Whether the column becomes a
  per-program override or is dropped is an open question and neither is urgent.
- **A week has no phase.** `session_periodization.phase` is per **program session**, and production
  shows ten sessions across three phases simultaneously. Anything that needs "the current phase" has
  to average over the sessions actually trained.
- **The exercise catalogue:** `muscles` is jsonb and order is **not** load-bearing; the tallies read
  it in a **live subquery**, so a correction re-derives history. Some rows are Title Case — fold case
  in any guard. The device mirror re-hydrates from `/api/workout-data` — **no APK for a catalogue
  change**.
- **Ownership on the sync-push path is not missing.** `pushMutations` →
  `logExerciseFromPayload(userId, …)` → `ensureWorkoutSession(userId, …)`, which is user-scoped and
  **404s rather than 403 to avoid a membership oracle**. Do not re-add `getWorkoutSessionOwners`.
- **Security:** the `VACUUM FULL` allowlist is a boundary, not validation — `hasOwnProperty`, never
  `in`. **DNS rebinding is NOT closed in `fetchPublicUrl`**: the address is validated, then the
  hostname is connected to by name.
- **`claude_ro` is row-scoped to ONE user** — every count from `/api/admin/db-query` is *the owner's*.
  Write findings as "none of the owner's", never "nothing is failing". **The generator reads the LIVE
  LOCAL SCHEMA, not `schema.ts`**, so stacked view regens are order-dependent, and a new column needs
  a NEW migration number — never an edit to the last one.
- **`pg_stat_user_tables` sizes are exact; `n_live_tup` is a stale planner estimate** (`last_analyze`
  is NULL on every table). To ask whether a table is empty, `count(*)`.
- **`error_events` DOES prune at 30 days** — the 2026-09-01 amendment claiming otherwise was wrong and
  is retracted in CLAUDE.md (BF-93). A prune fired from a write path only runs when something is
  written, so the oldest row ages past the cutoff between faults. Read "oldest row" against the **last
  write**, not against today.
- **The MODEL is reachable from this sandbox** — `GOOGLE_GENERATIVE_AI_API_KEY` is set and
  `generateObject` works through the proxy. Gate any shipped live test on `RUN_LIVE_AI_TESTS=1`, never
  on the key alone, or CI pays for it.
- **Sandbox limits:** the rollup cannot execute here (it needs the constants Q-49 removed). A stale
  local DB looks like a code defect; drop `/var/lib/postgresql/local-dev`. `npx next lint` is **not**
  `pnpm lint`. Drizzle will not marshal a JS array into `unnest(...)` in a raw `sql` template, and it
  cannot name a **functional** unique index (`COALESCE(col,'')`) as an `onConflictDoUpdate` target —
  select-then-branch inside a transaction instead.
