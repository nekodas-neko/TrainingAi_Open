# 🚧 Implementation Agent (A) — baton

> **Successor sessions are titled `🚧 Implementation Agent (A) 🟢`** — exactly, emoji included. The title
> is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a
> perfect baton.

**Updated:** 2026-08-31 · **By:** the twelfth session to run as Lane A · **Next ID:** `LA-44`
(`grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line)
**Migrations:** directory head **246**, next free **247** — claim against open PRs too, not just the
directory. Local SQLite **v32**.

## Now

**BF-2 is finished — all four steps.** What is left is LA-45 (Lane B: a screen that reads `bodyFatCorrected`) and LA-44 (no way to enter a scan at all). **Its outcome is still unobservable until LA-44** — `dexa_scans` and `measured_rmr` are both empty in production and neither has an entry surface — so do not read "nothing happened" as a broken calibration. **Do not refactor the per-consumer correction back into `listBodyMetrics`**: the Health log sheet seeds from that read and POSTs back at rank `manual`, so a corrected value there overwrites the raw archive. `check-body-fat-correction.js` holds the line.

`docs/implementation-backlog.md` is
**220 entries** — it grows while a session shrinks it, because five agents file into it concurrently.

**This session told the owner the Lane A queue was nearly exhausted; it was not** — re-running `next-item.js` showed **69 READY** with an entirely different top. The queue is scanned, never remembered.

Start with `node scripts/next-item.js --lane A` and read its real output — see the next section.

**⚠️ This baton used to call the remaining work "almost entirely owner- or device-gated". Wrong, and
it propagated — a session read the ~21 scoring entries at the top of READY, called the queue blocked,
then shipped six startable items from below them. Scroll past the scoring block.** Owner, 2026-08-26:
*leave the stuff gated on me for later and continue working through the queue of what you can do*.
Top of READY:

- **Q-289 / Q-290 / Q-272 / Q-507 / Q-508 / Q-422 / TN-10** — scoring calibrations. *Tuning proposes
  → owner signs off → Lane A implements.* Not Lane A's to start.
- **Q-388** — needs a night on the S25 with the pending APK. Owner-only.
- **Q-549 / Q-551** — Railway cost and hosting decisions.
- **13 entries** waiting on the device run the owner has agreed to make as written.

Do not manufacture an item to avoid saying so, and do not start a gated one to look busy.

## Read this before you trust the queue tool

`next-item.js` has mis-reported startability **three** times — LB-11's KEEP bucket, LA-23's dash-form
`Keep —` parse (#473), and LA-29, which listed at READY #4 an entry whose own heading read
`CLOSED 2026-08-25`: `check-backlog-pointers.js` had a rule for exactly that and its word list simply
had no `CLOSED` (Q-27 sat in the queue on that one word for three weeks; the list now lives in
`scripts/lib/completion-words.js` with a test). Every one was found by reading the tool's real output;
its tests passed throughout.

**Run it, read its output for your own lane, and distrust a top entry you recognise as done.**

## The habit that has now paid on every entry it has been applied to

**Re-verify an entry's premise against current `main` or production before building it, and write
down what you checked.** Of the eight entries taken this session, **six** had a stale or wrong
premise — including two written by this session. Q-501's own "5 of 33 disagree" was really 7 of 42,
with 27 of the "disagreements" simply carrying the *previous* model anchor. Q-403's recommended fix
(an injury gate) turned out unnecessary because the in-workout swap already mutates local state only.
The earlier session's six were Q-540 (sizing), Q-403 (tier), Q-295 (latency), Q-304b (method *and*
blast radius), BF-4 (hypotheses already answered), and the "add an admin button" request (the buttons
had shipped two days earlier).

Two shapes: *the evidence is stale*, and *the evidence was never true*. Q-295 is the one to remember — a review doc had carried the corrected number for a week while claiming it *"corroborates Q-295 exactly"*, and nobody propagated it.

**Q-304b is the sharpest case.** The owner authorised recomputing 30 rows; measuring first found the specified method moves **zero** rows by construction, the real blast radius is **277**, and **76 of those** would silently substitute a since-edited prescription. The authorisation was real and the work would still have been wrong.

## Shipped this session

**2026-08-30/31, thirteen PRs:** Q-311, Q-225, Q-297, Q-527, Q-211, LA-40, LB-14, Q-214, Q-284, LB-25, BF-67's plan (#666, which filed LA-43), LA-43 (#672), BF-2's plan (#673, which filed LA-44). What each turned out to be is in `docs/overview/entries/2026-08-3{0,1}-*.md`.

**LA-43 is the ninth moved premise this session** — filed against an unreachable `??` fallback; the
live defect was the exact-name filter above it silently deleting every paraphrase. **Two guards in
the fix were written and then measured away**: both survived every mutation and changed nothing
against the real catalogue, because the transform is symmetric. A clause that reads as protection
while providing none is worse than its absence.

Earlier sessions' PRs are in the journal entries; this list stays to the current session.

## Standing constraints

- **The local gate is `pnpm check:rules`** — quote its `Ran N of N`, never the word "pass". **63 of
  63** now. Never hardcode it; the runner reads it from `ci.yml`, which is the point.
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

- **`doc-size-baseline.json` is gone — LA-33 split it into one `docs/doc-size/<path>.size` file per
  tracked doc**, because every PR raising a number edited the same two lines of one shared JSON and
  so conflicted *by construction*. Two PRs raising two different docs now touch no common line; two
  raising the **same** doc still conflict, which is correct — they genuinely disagree about one
  number. Re-derive from the merged file's real length (**`grep -c "" <file>` + 1**, the convention
  the script uses), never by picking a side. `docs/doc-size-baseline-history.md` beside it stays
  append-only; there, keeping both sides *is* the resolution.
- **A backlog conflict is usually TWO DELETIONS — keep neither side.** Read the headings inside the
  hunk, then check `git diff --numstat origin/main -- docs/implementation-backlog.md`.
- **A mutation test that injects nothing reports a pass.** One did here: the anchor `sed` patched had
  changed, so nothing was mutated and the green suite "confirmed" a property it never tested.
  **Assert the mutation applied before believing the result** — one that does not mutate certifies.
- **`Gate:` must start its own bullet** — on one line after `Lane:` it is not read as a gate, and the
  entry stays READY while reading as gated. `check-backlog-pointers.js` catches it; do not eyeball it.
- **Relative links break when prose moves a directory deeper**; a stale `.next/types/validator.ts`
  makes `tsc` report a missing module for a deleted route. Clear it before diagnosing either.
- **A mutation can be semantically equivalent and still be a coverage gap.** Two survived this
  session's Q-501 pass and both were real: a pass-through storing `Math.round(input)` re-derives to
  the same score, so nothing noticed, while reporting an input the day never had; and the audit's
  "INPUT change" note firing *alongside* "MODEL moved" gives two contradictory verdicts, which leaves
  the reader exactly where the finding found them. **A surviving mutation is a question about the
  test, not a licence to stop.**
- **An entry's own stated invariant is a claim, not a fact — and Q-519's was false.** It said duration
  and efficiency are stored columns rather than derived from the span, and warned what would happen
  if anything ever derived them. `aggregateNight` already did. **When an entry names the assumption
  its design rests on, that sentence is the thing to go and check**, not the part to take on trust.
- **Two counts of the same thing can live on two tables.** `recovery_index_hours` exists on both
  `oura_daily_derived` (always NULL) and `oura_daily_summary` (populated, 50 of 51 rows). Querying
  the first nearly filed a finding that an estimator had never produced anything — contradicted by
  another entry's own `n = 42`. Same class as the `n_live_tup` error below: **when a count implies
  something drastic, check you are reading the table that holds the data.**
- **Inherited and still true:** `git reset --soft origin/main` does **not** merge — diff
  `--name-only` against `origin/main` before every push. Commit, push, *then* switch branches. Never
  slice a generated file by string index. A count moving further than your change explains is the bug.

## The database reclaim — closed

**Q-315 is closed** — the owner pressed the button and it correctly reclaimed **0 B**, because
`error_events` was never bloated (6,168 real rows, 5,928 of them one already-fixed burst that ages
out of the 30-day prune by ~2026-09-12). The "4 live rows in 49 MB" that started it was `n_live_tup`,
repeated through five documents including this one.

**Still binding: no bearer path on `/api/admin/vacuum` without an explicit yes — it is an auth
change.** The real gap is discoverability (a general DB control behind a row labelled for Oura, and
no maintenance tab on `/admin`): **Q-531**, filed, owner-gated, Lane B's.

## Waiting on the owner

The owner said on 2026-08-26 to *leave the stuff gated on me for later*. Do not chase these; do not
start one to look busy. **Answered since:** Q-403 (swap only on request), the readiness calibration
cluster (*"do it"*), the device run (*"it's fine — I'll run it as written"*).

- **Add `E2E` to `main`'s required checks.** LA-22 made the job always run and always report; nothing
  in this repository can make it required. Until it is, the gate is the five in Standing constraints.
- **One photo scan in the app** — unblocks BF-4 entirely (the nutrition scan-latency question).
- **Q-289 / Q-290 / Q-272 / Q-507 / Q-508 / Q-422 / TN-10** — Tuning-originated calibrations; owner
  signs off, then Lane A implements.
- **Q-388 SpO₂** — needs one night *without* the measurement sequence: a Kotlin change and a new APK.
  The owner's read is that sampling rate, not SpO₂ itself, is the likelier cost — worth measuring
  before changing anything.
- **Q-549 / Q-551** — Railway cost and hosting decisions.
- **The device run: 13 entries**, the owner has agreed to run the checklist as written.
- **Null the corrupt `body_comp` snapshot (2026-07-29)?** Q-527's guard is forward-only, so the row
  survives and Q-521 will read it. Recommended; the measurement stays in `body_metrics` either way.
- **Drop `oura_heartrate_user_updated`?** 18 MB, zero scans; reverses part of Q-180. It is Q-283's
  only material candidate, so that entry cannot finish without this call.

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
