# 🚧 Implementation Agent (A) — baton

> **Successor sessions are titled `🚧 Implementation Agent (A) 🟢`** — exactly, emoji included. The title
> is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a
> perfect baton.

**Updated:** 2026-08-25 · **By:** the eighth session to run as Lane A · **Next ID:** `LA-27`
(`grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line)
**Migrations:** `main`'s directory head is 219, but **220–223 are CLAIMED by the two open PRs below**,
so the next free number is **224** — claim against open PRs, not just the directory. Local SQLite
**v29** (BF-11e added the saved-meal tag table).

## Now

**Two PRs are open, the second is STACKED on the first, and both are waiting.**
- **#499 `chore/drop-running-baselines` (Q-301b)** — migrations 220 + 221. **All 6 checks green,
  base current, waiting on the OWNER.** A data-dropping migration is CLAUDE.md's confirm-first
  carve-out. The table has never held a row (`n_tup_ins` 0 for its whole life), so the risk is
  nominal — but ask, do not merge it for them.
- **#501 `feat/ai-call-log-cached-tokens` (Q-295)** — DRAFT, migrations 222 + 223. **Must not merge
  before #499**: 223 is a claude_ro regen generated after 220's drop, so it carries no
  `running_baselines` view and would strip that view while the table still existed. After #499
  lands: rebase, regenerate 223, re-run gates, undraft.

**Merged today:** #496 (Q-540 re-measured and parked), #500 (Q-295 re-measured and re-scoped).
Both are premise corrections, not features — see the lesson below.

Then `node scripts/next-item.js --lane A`.

## Read this before you trust the queue tool

`next-item.js` mis-ranked shipped entries as startable twice (LB-11's KEEP bucket, then LA-23's
dash-form `Keep —` parse, #473) — both found by reading its real output for your own lane, never by
its tests, which passed throughout.

**FOUR entries in a row had premises production contradicted** — BF-16a's seed drift, Q-403's tier,
Q-540's sizing, Q-295's latency. **Re-verify an entry's premise before building it.** Q-295 is the
one to remember: a review doc had carried the corrected number for a week while claiming it
*"corroborates Q-295 exactly"*, and nobody propagated it. Q-540 and Q-388 are now `Gate: owner` as a
result — but only 1 of Lane A's top 15 had owner-gating prose with no field, so that was a one-entry
fix, **not** a sweep.

**The lesson generalises past this bug.** LB-11 built the KEEP bucket the same morning and closed by
recording *"Lane A is unaffected in shape and now leads with `TN-3a`"* — a claim about the other lane,
made without running the other lane's query. Both defects in that parser were found by reading its
real output, never by its tests, which passed throughout. **Run the tool and read what it says about
your own lane** before taking its top row.

## The habit that has now paid on fourteen consecutive entries

**Re-verify an entry's premise against current `main` (or production) before building it, and write
down what you checked** — see the lesson above. The two shapes are "the entry's evidence is stale"
and "the entry's evidence was never true"; worked examples are in this session's journal entries.

## Shipped

#473 LA-23 (queue tool reads a dash Keep) · #475 BF-16a (migration **216**, v1.370.2) · #476 BF-18 ·
#477 + #481 TN-7 (Body Battery stress failure reports) · #480 + #486 BF-11b (one candidate per meal,
v1.372.0) · #482 BF-11e (migrations **217/218**, local SQLite **v29**) · #484 LA-25 · #487 BF-11g ·
#489 LA-24 Kind 1 (migration **219**) · #490 BF-20 · #496 Q-540 · #500 Q-295.

**LA-24 is now a question, not work.** Kind 1 shipped; what is left is `Gate: owner` — extending
BF-16a's `Barbell Shrug`/`Barbell Hip Thrust` additions to their families is the same anatomical call
made five more times unasked. Written for an answer, not an implementer.

**BF-19 is the top READY item and was deliberately NOT taken.** Four-part telemetry whose own entry
says the numbers only mean something once the reporter has run on the S25 — it produces data nobody
can read until a device run. Not a judgement that it is unimportant; it needs the device.

**Three timing-dependent test defects shipped and were fixed in one day, all mine** — an async write
allowed zero ms, rows counted from two racing fire-and-forget calls, a 4.3 s module import inside a
5 s budget. One root, narrower than "async": **something in the test is timed that is not the
behaviour being asserted.** Ask that before writing an assertion.

## Standing constraints

- **The local gate is `pnpm check:rules`** — quote its `Ran N of N`, never the word "pass". It is
  **58 of 58** now — LA-26 added the dead-repo-method guard. Never hardcode it; the runner reads it
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
  One hunk's `origin/main` side carried **LA-24 (shipped, keep) and BF-18 (drop) together** — "keep
  theirs" resurrects a finished entry, "keep mine" deletes a live one. Read the headings inside the
  hunk, then check `git diff --numstat origin/main -- docs/implementation-backlog.md`: expect
  `0 <n>` and one removed heading, nothing added.
- **`doc-size-baseline.json` was raised three times in one session and superseded every time.** With
  several PRs in flight it is only correct against the merged predecessor: always
  `git show origin/main:docs/doc-size-baseline.json > …` and re-derive, never splice. The history
  file beside it is append-only — there, keeping both sides *is* the resolution.
- **`projectOverview.md` conflicts on the Current Status header every time** — both sides add a
  paragraph after `**Version:**`. Keep both paragraphs and the higher version's header. It contains
  the literal `` `<<<<<<< HEAD` `` in prose, so never assert on a naive marker search — run
  `node scripts/check-conflict-markers.js`.
- **Inherited and still true:** `git reset --soft origin/main` does **not** merge — diff
  `--name-only` against `origin/main` before every push. Commit, push, *then* switch branches.
  Never slice a generated file by string index. A count that moves further than your change explains
  is the bug. `psql -tAc` output carries a trailing newline.

## A park that was overridden, and why it may need to happen again

**TN-7 was `PARKED` on `Needs: TN-4` and shipped anyway.** A `Needs:` clears when its target leaves
the queue, and TN-4 will not leave — its residue is *why* the constants were unset, an open question,
not unbuilt work. TN-4's catch block is on `main`, so the dependency held in substance and blocked
only in the tool. **A `Needs:` pointing at an open question rather than unbuilt work is a park with
no end date.** Check which kind it is before honouring it.

## The database reclaim — one press left

`VACUUM FULL error_events` (**Q-315**, ~49 MB, **27% of the database** at 28 live rows) is the only
piece outstanding and **has no button** — it needs `POST /api/admin/vacuum {"table":"error_events"}`
with an admin session cookie, which a sandbox cannot produce. **Do not add a bearer path to that
route without an explicit yes — it is an auth change.** Runbook:
[`docs/handoff-2026-08-18-platform-database-reclaim.md`](../../handoff-2026-08-18-platform-database-reclaim.md).

## Waiting on the owner

- **#499** — the drop above. Green and blocked only on a yes.
- **LA-24's second half** (`Gate: owner`) — whether the shrug/glute-bridge families follow BF-16a's
  additions. Its first half needs no gate.
- **Q-422** is Tuning-originated: *Tuning proposes → owner signs off → Lane A implements*.
- **Q-388 SpO₂ is not a code question** — the missing datum is one night *without* the measurement
  sequence, needing a Kotlin change and a new APK. Now `Gate: owner`.
- Device checks owed and accumulating: **Q-400** (also decides Q-411), **Q-413**, **Q-412**,
  **Q-405**, **Q-310**, BF-16a's catalogue hydration, plus everything from the last three sessions.

## Claimed paths

- `scripts/lib/`, `lib/media/`, `android/…/media/`, `lib/net/safe-fetch.ts`, `app/api/admin/vacuum/`,
  `app/api/oura-ble/rekey/`, `lib/data/postgres/slices/oura-raw-{frames,pack}.ts`,
  `packages/shared/src/workout/derive-session-rpe.ts`,
  `packages/shared/src/health/workout-energy.ts` — Lane A's.
- `scripts/` sits in neither lane's path list and the rule does not decide it. Claim per PR, release
  on merge — LB-11 and #473 both did.
- `components/nutrition/meal-label-*` is **Lane B's**.

## Findings, so they are not re-derived

*The raw-frame half moved to [`docs/oura-ble-operations.md`](../../oura-ble-operations.md) §5 on
2026-08-25, per the instruction this section carried for five batons. Keep it there.*

- **The exercise catalogue:** `muscles` is jsonb, order is **not** load-bearing (every consumer
  filters on `role`; none indexes the array), and the tallies read it in a **live subquery**, so a
  catalogue correction re-derives history rather than applying only forward. A few rows carry Title
  Case values, so any guard on muscle names folds case. The device's local mirror re-hydrates from
  `/api/workout-data` in `workout-screen.tsx:421` — **no APK needed for a catalogue change**.
- **Security:** the `VACUUM FULL` allowlist is a boundary, not validation — `hasOwnProperty`, never
  `in`. **DNS rebinding is NOT closed in `fetchPublicUrl`**: the address is validated, then the
  hostname is connected to by name.
- **`claude_ro` is row-scoped to ONE user** — every count from `/api/admin/db-query` is *the owner's*.
  Write findings as "none of the owner's", never "nothing is failing". Views scope on
  `current_setting('app.claude_ro_owner', true)` (set by `bootstrapClaudeRoOwner()`) — no manual step.
  **The generator reads the LIVE LOCAL SCHEMA, not `schema.ts`**, so stacked view regens are
  order-dependent.
- **The MODEL is reachable from this sandbox** — `GOOGLE_GENERATIVE_AI_API_KEY` is set and
  `generateObject` works through the proxy, so AI behaviour can be **measured**: BF-11b's split rule
  read 5,5,1,1,5,1 on its headline case and 30/30 after one wording change. No `tsx` — drive probes
  as throwaway `*.test.ts` under vitest (it resolves `@/`). Gate any shipped live test on
  `RUN_LIVE_AI_TESTS=1`, never on the key alone, or CI pays for it.
- **Sandbox limits:** the rollup cannot execute here (needs the vendored constants Q-49 removed), so
  anything wanting a rollup pass is owner-only. A stale local DB looks like a code defect — drop
  `/var/lib/postgresql/local-dev`. `npx next lint` is **not** `pnpm lint`. Drizzle will not marshal a
  JS array into `unnest(...)` in a raw `sql` template.
