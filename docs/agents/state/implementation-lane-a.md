# 🚧 Implementation Agent (A) — baton

> **Successor sessions are titled `🚧 Implementation Agent (A) 🟢`** — exactly, emoji included. The title
> is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a
> perfect baton.

**Updated:** 2026-08-25 · **By:** the eighth session to run as Lane A · **Next ID:** `LA-27`
(`grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line)
**Migrations:** through 221; next free is **222**. Local SQLite **v29** (BF-11e added the saved-meal
tag table).

## Now

**One PR in flight: `chore/drop-running-baselines` (Q-301b)** — migrations 220 + 221, suite green.
Drive it to green if it has not merged; otherwise nothing is in flight. Then
`node scripts/next-item.js --lane A`.

**Q-540 and Q-388 were parked today** after re-measuring their premises against production rather
than reading them — both had sat in READY looking startable, and both are now `Gate: owner`. Detail:
`docs/overview/entries/2026-08-25-drop-running-baselines.md` and PR #496. Only 1 of Lane A's top 15
had owner-gating prose with no field, so that was a one-entry fix, **not** a sweep — don't make it one.

**Lesson worth carrying:** three entries in a row had premises production contradicted (BF-16a,
Q-403, Q-540). Re-verify before implementing.

## Read this before you trust the queue tool

`next-item.js` mis-ranked shipped entries as startable twice (LB-11's KEEP bucket, then LA-23's
dash-form `Keep —` parse, #473) — both found by **reading its real output for your own lane**, never
by its tests, which passed throughout. Do that before taking its top row.

## The habit that has now paid on fourteen consecutive entries

**Re-verify an entry's premise against current `main` before building it, and write down what you
checked.** Two of four this session:

| entry | what it said | what was true |
|---|---|---|
| **BF-16a** | *"Surface: production data. Not reproducible against the local seed."* | Reproduces exactly. All 140 seeded rows fingerprint identically in the dev DB and production — it is a defective **seed** (008/032), not drift, so the fix could be proved through the live route instead of argued |
| **TN-7** | `console.error` does not reach `error_events` | True — `reportServerError` → `repo.insertErrorEvent` is the only writer, nothing bridges the console. Checked rather than taken on faith, and it is the whole basis of the entry |

## Shipped

#473 LA-23 (queue tool reads a dash Keep) · #475 BF-16a (migration **216**, catalogue muscles,
v1.370.2) · #476 BF-18 (autopack test polls the final phase) · #477 TN-7 (Body Battery stress failure
reports) · #480 BF-11b (scan returns one candidate per meal, v1.372.0) · #481 TN-7 follow-up ·
#482 BF-11e (migration **217/218**, local SQLite **v29**, saved-meal tags) · #484 LA-25 (journal
sweep) · #486 BF-11b follow-up · #487 BF-11g (library-first meal plan) · #489 LA-24 Kind 1
(migration **219**) · #490 BF-20 (repo-root guard).

**LA-24 is now a question, not work.** Its Kind 1 shipped; what is left is `Gate: owner` — BF-16a's
additions to `Barbell Shrug` and `Barbell Hip Thrust` had no in-catalogue precedent, so extending
them to the shrug and glute-bridge families is the same anatomical call made five more times unasked.
The entry is written for an answer rather than an implementer.

**BF-19 is the top READY item and was deliberately NOT taken.** It is a four-part telemetry feature
(client reporter, ingest route, aggregate route, retention) whose own entry says the numbers only
mean something once the reporter has run on the S25 — so it produces data nobody can read until a
device run. BF-20 was taken instead because it fails *every open PR*, not just its own. Not a
judgement that BF-19 is unimportant; it needs the device, and this session had none.

**Three timing-dependent test defects shipped and were fixed in one day, all mine.** BF-18 allowed an
async write zero milliseconds; TN-7's test counted rows written by two racing fire-and-forget calls;
BF-11b's test paid a **4.3 s module import inside a 5 s budget**. One root, narrower than "async":
**something in the test is timed that is not the behaviour being asserted.** Ask that before writing
an assertion — a module import, a background write and a second writer are all answers to it.

## Standing constraints

- **The local gate is `pnpm check:rules`** — quote its `Ran N of N`, never the word "pass". It is
  **57 of 57** now — BF-20 added the repo-root guard. Do not hardcode it; the runner reads the count
  from `ci.yml`, which is the whole point of quoting the number rather than the word "pass".
- **The clone is depth 1.** `git fetch --deepen=200 origin main` before any `git merge origin/main`,
  or it refuses as "unrelated histories". Hit twice this session; it is not optional.
- **`get_check_runs` returning `total_count: 0`** right after a push is **registration lag**, not a
  stale base — tell them apart with `git merge-base --is-ancestor origin/main HEAD`. Confirmed again
  this session: ancestor check passed, checks appeared a minute later.
- **E2E is not a required check** (LA-22, `Gate: owner`). The five that gate a merge are Lint, Tests,
  Build, Custom Rules, Migration Check.
- **`pnpm dev` works.** The previous baton's missing `@sentry/nextjs` is gone. Log in as
  `test@local.dev` / `testpass123` via `/api/auth/callback/credentials` with the CSRF token from
  `/api/auth/csrf`. The `[instrumentation] MODEL ASSETS UNAVAILABLE — SignatureDoesNotMatch (403)`
  line at boot is the known Q-49 sandbox limit, not a fault; the server continues degraded.
- **Nothing has run on the S25 for three sessions.** Anything touching offline-first, native,
  safe-area, gestures or notifications needs the device smoke run or an explicit Known-Issues row.

## Traps this session walked into, so you do not

- **A backlog conflict can be a deletion against an insertion, and then NEITHER side is right.**
  CLAUDE.md warns that these are usually two deletions. This one was worse: `origin/main`'s side of
  one hunk carried **LA-24 (shipped, keep) and BF-18 (completed here, drop) together**, so "keep
  theirs" resurrects a finished entry and "keep mine" deletes a live one. **Read the headings inside
  the hunk, then check the resolved diff**: `git diff --numstat origin/main -- docs/implementation-backlog.md`
  should show `0 <n>` and one removed heading, nothing added.
- **`doc-size-baseline.json` was raised three times in one session and superseded every time.** With
  several PRs in flight the number is only correct against the merged predecessor. Always
  `git show origin/main:docs/doc-size-baseline.json > …` and re-derive; never splice the hunk. The
  history file beside it is append-only — there, keeping both sides *is* the resolution.
- **`projectOverview.md` conflicts on the Current Status header every single time**, because both
  sides add a paragraph after the `**Version:**` line. Keep both paragraphs and one header (the
  higher version). It contains the literal text `` `<<<<<<< HEAD` `` in prose, so never assert on a
  naive marker search — run `node scripts/check-conflict-markers.js`, which knows the difference.
- **Inherited and still true:** `git reset --soft origin/main` does **not** merge — diff
  `--name-only` against `origin/main` before every push. Commit, push, *then* switch branches.
  Never slice a generated file by string index. A count that moves further than your change explains
  is the bug. `psql -tAc` output carries a trailing newline.

## A park that was overridden, and why it may need to happen again

**TN-7 was `PARKED` on `Needs: TN-4` and shipped anyway.** A `Needs:` clears when its target leaves
the queue; TN-4 will not leave, because its residue is *why* the constants were unset for ten hours
on a fault that stopped by itself and whose evidence prunes **2026-09-22**. TN-7 was parked behind an
investigation it is the prerequisite for. Its own text settles it — *"a follow-up to what TN-4
shipped"* — and TN-4's catch block is on `main`, so the dependency was satisfied in substance and
blocked only in the tool. **The general shape: a `Needs:` pointing at an entry whose residue is an
open question, rather than at unbuilt work, is a park with no end date.** Check which kind it is
before honouring it.

## The database reclaim — one press left

`VACUUM FULL error_events` (**Q-315**, ~49 MB, **27% of the whole database** at 28 live rows) is the
only piece outstanding, and **there is no button for it** — the admin UI's vacuum control covers
`oura_raw_samples`. It needs `POST /api/admin/vacuum {"table":"error_events"}` with an admin session
cookie, which a sandbox cannot produce. **Do not add a bearer path to that route without an explicit
yes — it is an auth change.** Runbook: [`docs/handoff-2026-08-18-platform-database-reclaim.md`](../../handoff-2026-08-18-platform-database-reclaim.md).

## Waiting on the owner

- **LA-24's second half** (`Gate: owner`) — whether the shrug and glute-bridge families follow
  BF-16a's additions. Its first half (five rows a family member already answers) needs no gate.
- **Q-422** is Tuning-originated: *Tuning proposes → owner signs off → Lane A implements*.
- **Q-388 SpO₂ is not a code question.** The missing datum is one night *without* the automatic
  measurement sequence, which needs a Kotlin change and a new APK.
- Device checks owed and accumulating: **Q-400** (also decides Q-411), **Q-413**, **Q-412**,
  **Q-405**, **Q-310**, BF-16a's catalogue hydration, plus everything from the last three sessions.

## Claimed paths

- `scripts/lib/`, `lib/media/`, `android/…/media/`, `lib/net/safe-fetch.ts`, `app/api/admin/vacuum/`,
  `app/api/oura-ble/rekey/`, `lib/data/postgres/slices/oura-raw-{frames,pack}.ts`,
  `packages/shared/src/workout/derive-session-rpe.ts`,
  `packages/shared/src/health/workout-energy.ts` — Lane A's.
- `scripts/` sits in neither lane's path list and the ownership rule does not decide it. LB-11
  claimed it once and released on merge; #473 did the same. Claim per PR, release on merge.
- `components/nutrition/meal-label-*` is **Lane B's**.

## Findings, so they are not re-derived

*Inherited on its fifth baton. **Move the Oura half to
[`docs/oura-ble-operations.md`](../../oura-ble-operations.md) rather than carrying it a sixth time.***

- **The exercise catalogue:** `muscles` is jsonb, order is **not** load-bearing (every consumer
  filters on `role`; none indexes the array), and the tallies read it in a **live subquery**, so a
  catalogue correction re-derives history rather than applying only forward. A few rows carry Title
  Case values, so any guard on muscle names folds case. The device's local mirror re-hydrates from
  `/api/workout-data` in `workout-screen.tsx:421` — **no APK needed for a catalogue change**.
- **Raw frames:** read only via `slices/oura-raw-frames.ts` (a hot-only read silently returns 7 days);
  an aggregate cannot use its dedupe — anti-join on `(epoch, tag, ds_bucket)`.
  `oura_raw_samples.measured_at` and `event_name` are **dead columns**, owner-gated to drop. A ds
  regression is **not** a ring-clock reset (Q-314) — a re-drain makes one. The packer's phase-3
  delete goes by **row id**, never by bucket range, and its three phases commit **separately**: any
  test asserting the delete must poll (BF-18).
- **Security:** the `VACUUM FULL` allowlist is a boundary, not validation — `hasOwnProperty`, never
  `in`. **DNS rebinding is NOT closed in `fetchPublicUrl`**: the address is validated, then the
  hostname is connected to by name.
- **`claude_ro` is row-scoped to ONE user** — every count from `/api/admin/db-query` is *the
  owner's*. Write findings as "none of the owner's", never "nothing is failing". It needs no manual
  step: views scope on `current_setting('app.claude_ro_owner', true)`, set by `bootstrapClaudeRoOwner()`.
- **The MODEL is reachable from this sandbox** — `GOOGLE_GENERATIVE_AI_API_KEY` is set and
  `generateObject` works through the proxy, so an AI behaviour change can be **measured** rather than
  reasoned about. BF-11b's split rule read 5,5,1,1,5,1 on its headline case and 30/30 after one
  wording change; neither number was reachable any other way. There is no `tsx` — drive a probe as a
  throwaway `*.test.ts` under vitest, which resolves the `@/` alias. Gate a shipped live test on an
  explicit `RUN_LIVE_AI_TESTS=1`, never on the key alone, or CI starts paying for it.
- **Sandbox limits:** the rollup cannot execute here (needs the vendored constants Q-49 removed), so
  anything wanting a rollup pass is owner-only. A stale local DB looks like a code defect — drop
  `/var/lib/postgresql/local-dev`. `npx next lint` is **not** `pnpm lint`. Drizzle will not marshal a
  JS array into `unnest(...)` in a raw `sql` template.
