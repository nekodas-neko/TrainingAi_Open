# 🚧 Implementation Agent (A) — baton

> **Successor sessions are titled `🚧 Implementation Agent (A) 🟢`** — exactly, emoji included. The title
> is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a
> perfect baton.

**Updated:** 2026-08-25 · **By:** the ninth session to run as Lane A · **Next ID:** `LA-30`
(`grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line)
**Migrations:** directory head **224**, next free **225** — claim against open PRs too, not just the
directory. Local SQLite **v29**.

## Now

**Nothing of Lane A's is open or blocked.** Twelve PRs merged this session (list below); the last,
#513, landed the compaction chore. `docs/implementation-backlog.md` is **202 entries**.

Start with `node scripts/next-item.js --lane A` and read its real output — see the next section.

**What the top of READY currently holds, and why none of it was taken:**
- **TN-9 / Q-289 / Q-290** — scoring changes. *Tuning proposes → owner signs off → Lane A implements.*
  Not Lane A's to start.
- **BF-19** — four-part load telemetry whose own entry says the numbers mean nothing until the
  reporter has run on the S25. It produces data nobody can read without a device.
- **Q-403** — a product decision with two candidate fixes, put to the owner and not yet answered.

The honest state is *waiting on the owner or the device*, not *out of work*. Do not manufacture an
item to avoid saying so.

## Read this before you trust the queue tool

`next-item.js` has now mis-reported startability **three** times — LB-11's KEEP bucket, LA-23's
dash-form `Keep —` parse (#473), and this session's LA-29. Every one was found by reading its real
output for this lane; its tests passed throughout.

**LA-29 is the one to learn from.** It listed **Q-304b at READY #4** — an entry whose heading reads
`CLOSED 2026-08-25` and whose first bullet reads *"This entry is closed, not parked"*, written by
this session hours earlier. `check-backlog-pointers.js` has a rule for exactly that, and its word
list simply had no `CLOSED`. Two entries were sitting in the queue on that one word (Q-27 for three
weeks). The list now lives in `scripts/lib/completion-words.js` with a test.

**Run the tool, read its output for your own lane, and distrust a top entry you recognise as done.**

## The habit that has now paid on sixteen consecutive entries

**Re-verify an entry's premise against current `main` or production before building it, and write
down what you checked.** Six entries this session had premises production contradicted — Q-540
(sizing), Q-403 (tier), Q-295 (latency), Q-304b (method *and* blast radius), BF-4 (hypotheses already
answered), and the "add an admin button" request (the buttons had shipped two days earlier).

Two shapes: *the evidence is stale*, and *the evidence was never true*. Q-295 is the one to remember
— a review doc had carried the corrected number for a week while claiming it *"corroborates Q-295
exactly"*, and nobody propagated it.

**Q-304b is the sharpest case.** The owner authorised recomputing 30 rows; measuring first found the
specified method moves **zero** rows by construction, the real blast radius is **277**, and **76 of
those** would silently substitute a since-edited prescription. The authorisation was real and the
work would still have been wrong.

## Shipped this session

#496 Q-540 · #499 Q-301b (migrations **220/221**, `running_baselines` dropped) · #500 Q-295 ·
#501 Q-295 cached tokens (migrations **222/223**) · #502 · #504 · #505 · #507 LA-26 (dead-repo-method
check) · #509 LA-28 (six dead methods deleted) · #510 · #511 (orphaned vacuum route) ·
#513 (compaction: BF-4 and Q-388 → `docs/reviews/`).

Also **migration 224** (LA-24 Kind 2, the shrug and glute-bridge families) — the owner answered
LA-24's gated half *yes, for now*, and the migration header carries that qualifier so it is not lost.
Earlier sessions' PRs are in the journal entries; this list stays to the current session.

## Standing constraints

- **The local gate is `pnpm check:rules`** — quote its `Ran N of N`, never the word "pass". **58 of
  58** now. Never hardcode it; the runner reads it from `ci.yml`, which is the point.
- **The clone is depth 1.** `git fetch --deepen=300 origin main` before any `git merge origin/main`,
  or it refuses as "unrelated histories". Hit repeatedly; it is not optional.
- **`get_check_runs` at `total_count: 0`** right after a push is registration lag, not a stale base
  — tell them apart with `git merge-base --is-ancestor origin/main HEAD`.
- **E2E is not a required check.** The five that gate a merge are Lint, Tests, Build, Custom Rules,
  Migration Check.
- **A check run that dies in seconds with no logs is GitHub Actions infrastructure**, not your diff.
  #511 failed on a DNS error fetching `pnpm/action-setup`. One re-run is sanctioned; a second failure
  is real.
- **`pnpm dev` works.** `test@local.dev` / `testpass123` via `/api/auth/callback/credentials` with the
  CSRF token from `/api/auth/csrf`. The `MODEL ASSETS UNAVAILABLE — SignatureDoesNotMatch (403)` line
  at boot is the known Q-49 sandbox limit, not a fault.
- **Nothing has run on the S25 for four sessions.** Anything touching offline-first, native,
  safe-area, gestures or notifications needs the device smoke run or an explicit Known-Issues row.

## Traps this session walked into, so you do not

- **`doc-size-baseline.json` needed re-deriving twice, and picking either side was wrong both times**
  (11948 vs 11997 → 11924; then 11924 vs 12219 → 12146). Always
  `git show origin/main:docs/doc-size-baseline.json`, then re-derive from the merged file's real
  length — **`grep -c "" <file>` + 1**, which is the convention the script uses. The history file
  beside it is append-only; there, keeping both sides *is* the resolution.
- **A backlog conflict is usually TWO DELETIONS — keep neither side.** Read the headings inside the
  hunk, then check `git diff --numstat origin/main -- docs/implementation-backlog.md`.
- **A mutation test that injects nothing reports a pass.** One did here: the anchor `sed` patched had
  changed, so nothing was mutated and the green suite "confirmed" a property it never tested.
  **Assert the mutation applied before believing the result** — one that does not mutate certifies.
- **`- **Lane:** A · **Gate:** owner` on one line is not read as a gate.** `Gate:` must start its own
  bullet. Written this way twice this session; both entries would have stayed READY while reading as
  gated. `check-backlog-pointers.js` catches it — run it, do not eyeball it.
- **Relative links break when prose moves a directory deeper** — five did while extracting to
  `docs/reviews/`. A stale `.next/types/validator.ts` likewise makes `tsc` report a missing module
  for a deleted route; clear it before diagnosing either.
- **Inherited and still true:** `git reset --soft origin/main` does **not** merge — diff
  `--name-only` against `origin/main` before every push. Commit, push, *then* switch branches. Never
  slice a generated file by string index. A count moving further than your change explains is the bug.

## The database reclaim — one press left

`VACUUM FULL error_events` (**Q-315**, ~49 MB, **27% of the database** at 28 live rows). **It now
has a button** — Lane B shipped it 2026-08-25 — at **More → Settings → Developer → "Oura BLE debug"
→ Table = `error_events` → "Reclaim disk"**. The previous baton said it needed a `curl`; that was
already stale when written. **Do not add a bearer path to `/api/admin/vacuum` without an explicit
yes — it is an auth change.**

Discoverability, not capability, is what is actually missing: a general database control sits behind
a row labelled for Oura, and `/admin` has no maintenance tab. That is **Q-531**, already filed,
already owner-gated, and **Lane B's** by the path rule.

## Waiting on the owner

- **One photo scan in the app** — unblocks BF-4 entirely (the nutrition scan-latency question).
- **The `error_events` reclaim button-press** above — the last piece of Q-315.
- **Q-403** — the Coach's already-applied-swap wording. A product decision with two candidates.
- **Q-422** and **TN-9 / Q-289 / Q-290** — Tuning-originated; owner signs off, then Lane A implements.
- **Q-388 SpO₂** — the missing datum is one night *without* the measurement sequence: a Kotlin change
  and a new APK, so owner-only.
- Device checks owed and accumulating: **Q-400** (also decides Q-411), **Q-413**, **Q-412**,
  **Q-405**, **Q-310**, BF-16a's catalogue hydration, plus everything from the last four sessions.

## Claimed paths

- `scripts/lib/`, `lib/media/`, `android/…/media/`, `lib/net/safe-fetch.ts`, `app/api/admin/vacuum/`,
  `app/api/oura-ble/rekey/`, `lib/data/postgres/slices/oura-raw-{frames,pack}.ts`,
  `packages/shared/src/workout/derive-session-rpe.ts`,
  `packages/shared/src/health/workout-energy.ts` — Lane A's.
- `scripts/` sits in neither lane's path list and the rule does not decide it. Claim per PR, release
  on merge — LB-11, #473, #507 and #509 all did.
- `components/nutrition/meal-label-*` is **Lane B's**.

## Findings, so they are not re-derived

*The raw-frame half lives in [`docs/oura-ble-operations.md`](../../oura-ble-operations.md) §5. Keep
it there.*

- **The exercise catalogue:** `muscles` is jsonb and order is **not** load-bearing (consumers filter
  on `role`, none indexes the array); the tallies read it in a **live subquery**, so a correction
  re-derives history rather than applying only forward. Some rows are Title Case — fold case in any
  guard. The device mirror re-hydrates from `/api/workout-data` — **no APK for a catalogue change**.
- **Ownership on the sync-push path is not missing.** `pushMutations` →
  `logExerciseFromPayload(userId, …)` → `ensureWorkoutSession(userId, …)`, which is user-scoped,
  refuses another user's session id, and **404s rather than 403 to avoid a membership oracle**. This
  is what let LA-28 delete `getWorkoutSessionOwners`/`getExerciseLogOwners`; do not re-add them
  reflexively.
- **Security:** the `VACUUM FULL` allowlist is a boundary, not validation — `hasOwnProperty`, never
  `in`. **DNS rebinding is NOT closed in `fetchPublicUrl`**: the address is validated, then the
  hostname is connected to by name.
- **`claude_ro` is row-scoped to ONE user** — every count from `/api/admin/db-query` is *the owner's*.
  Write findings as "none of the owner's", never "nothing is failing". Views scope on
  `current_setting('app.claude_ro_owner', true)` (set by `bootstrapClaudeRoOwner()`) — no manual step.
  **The generator reads the LIVE LOCAL SCHEMA, not `schema.ts`**, so stacked view regens are
  order-dependent.
- **`pg_stat_user_tables` sizes are exact; `n_live_tup` is a stale planner estimate** (`last_analyze`
  is NULL on every table). `n_tup_ins` is a lifetime counter and trustworthy — it proved
  `running_baselines` never held a row. To ask whether a table is empty, `count(*)`.
- **The MODEL is reachable from this sandbox** — `GOOGLE_GENERATIVE_AI_API_KEY` is set and
  `generateObject` works through the proxy, so AI behaviour can be **measured**. No `tsx` — drive
  probes as throwaway `*.test.ts` under vitest (it resolves `@/`). Gate any shipped live test on
  `RUN_LIVE_AI_TESTS=1`, never on the key alone, or CI pays for it.
- **Sandbox limits:** the rollup cannot execute here (it needs the constants Q-49 removed), so a
  rollup pass is owner-only. `psql` and direct `pg` access are blocked by the command classifier —
  use `pnpm db:local` or a `.cjs` probe at the repo root. A stale local DB looks like a code defect;
  drop `/var/lib/postgresql/local-dev`. `npx next lint` is **not** `pnpm lint`. Drizzle will not
  marshal a JS array into `unnest(...)` in a raw `sql` template.
