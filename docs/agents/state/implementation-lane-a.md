# Implementation Agent (A) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (A) 🚧`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-19 · **By:** the fourth session to run as Lane A · **Next ID:** `LA-1` (bands are gone — see `docs/agents/README.md` §3; legacy Q-314…349 stay valid where already used)
**Migrations:** 189–203 taken; next free is **204**. Local SQLite **v27**, untouched this session.

## Now

**Nothing is half-built.** Every branch this session opened is either merged or has an open PR with
CI running; there is no work-in-progress to pick up mid-stream. Start by clearing the open PRs below,
then take the queue top-down.

### The one thing that recurred often enough to be the headline

**Re-verify an entry's premise against current `main` before implementing it, and write down what you
checked.** Seven entries in a row failed this check in one session, and the checks were cheap:

| Entry | What the entry said | What was true |
|---|---|---|
| **Q-412** | needs the full outbox + push + delta chain | `meal_types` is not an outbox domain — that code would have had no caller |
| **Q-360** | the seed uses literal dates, make it relative | it has been relative since the repo's first commit; the DB was just stale |
| **Q-324** | the first suite run on a fresh DB times out | did not reproduce — 516 files green on the exact condition |
| **Q-405** | recommend from the library's default-role column | there is no such column, and the owner's own exercise is not in the library at all |

It is also what *found* things: scoping Q-412 turned up **Q-325**, a live defect that would have
silently voided Q-413's whole point. Budget the check; it has paid every time.

### The database reclaim is still the standing deadline item, and it has not moved

Inherited unchanged for the third baton running, because **no session has been able to touch it**:

| Step | Worth | State |
|---|---:|---|
| Migration **193** drops `idx_oura_raw_samples_user_measured` | **136 MB** | ✅ merged, landed on deploy |
| Pack the raw frames (Q-541 Task 5 backfill) | **~630 MB** | ⛔ **needs a press against production** |
| `VACUUM FULL error_events` (Q-315) | **~49 MB** | ⛔ **needs a press against production** |

Every reclaim is admin-session-gated and a sandbox session cannot authenticate to production
(`CLAUDE_DB_QUERY_SECRET` is read-only; `ADMIN_EXPORT_SECRET` is GET-only on one route). Either the
owner runs the curls, or Lane B builds the buttons (Q-316), or a **confirm-first** bearer path is
added — **do not build the third without an explicit yes, it is an auth change.** Runbook:
[`docs/handoff-2026-08-18-platform-database-reclaim.md`](../../handoff-2026-08-18-platform-database-reclaim.md).

## Open PRs — clear these first

- **#220** `docs/q405-premise-check` — the Q-405 premise findings, annotated onto the entry.
  **Merge this BEFORE #222**, which removes that entry entirely; the findings survive in #222's
  journal entry, so the annotation vanishing is correct, not a loss.
- **#222** `feat/coach-swap-role-prompt` — Q-405 itself. Version bumped to **1.330.0**.
- **#124 (Q-479) is deliberately open and must NOT be merged.** Owner, verbatim: *"leave that as a
  known issue for now - only admin will be me for a long time."* Do not re-implement it either.

## Shipped this session (for orientation, not credit)

**Q-322 finished** — slices 6–9 landed and the bounded-body sweep is complete: **210 route files, 0
bare `req.json()` reads**, and the shrink-only ratchet became a flat check in the same PR. It began
at 104 reads across 92 files.

Also merged: **Q-400** (meal label → gallery over a new `MediaSave` MediaStore bridge, plus the
`pHYs` chunk so it prints at 50 mm rather than 312), **Q-413** (`logged_at` means when you ate),
**Q-325** (the `food_logs` pull updated 4 of 8 columns), **Q-412** (reassign a meal type's entries
instead of deleting them), **Q-360** (retired as a wrong premise), **Q-324's mechanism half** (the
local migration runner records what it applied), **Q-323's Lane A half** (carbs and fat scale with
earned calories, protein holds).

## Next

1. **Q-403** is tagged **Lane B** by its own entry even though `app/api/coach/route.ts` is a Lane A
   path — the fix is the system prompt. Honour the tag; do not take it on the path rule.
2. **Q-404** `[platform]` — wire the Sentry SDK. Lane A, but it involves a DSN and config, so treat
   the secret handling as **confirm-first**.
3. **Q-410** `[cardio][devices]` — the guided walk's cadence signal is gated and reads `--`.
4. **Q-396** `[nutrition][platform]` — a photo per saved meal; the entry says the size cap is the
   whole design, so it is mostly a storage/API decision.
5. **Skip:** Q-359, Q-414, Q-415, Q-486, Q-326 (all Lane B) and Q-479 (owner-deferred).

**Entries deliberately left in the queue, annotated as partially done — do not remove them and do not
re-implement their shipped halves:** **Q-324** (mechanism fixed, timeout symptom unconfirmed),
**Q-323** (arithmetic + API shipped, the ring/bar rendering is Lane B), **Q-387** (storage shipped,
the button and counter are Lane B).

**Filed by this session:** Q-324, Q-325 (shipped inside Q-413's PR), Q-326 (Lane B follow-up to
Q-412).

## Blocked

- **Q-541 Task 5 and Q-315** — on the owner (the three options above).
- **Q-537** — approved, unverifiable from the sandbox.

**Owed rather than blocked — the device checks are accumulating, and one of them gates another
entry:**

- **Q-400 is the important one.** Install the APK from `apk-latest`, tap **Save to gallery**, find
  the file in the Samsung Gallery, then **print once and measure**. That single print answers three
  questions: does the file arrive, does it measure 50 mm rather than 312, and **does Q-411's circle
  template crop the corners or scale the square inside the circle** — which decides whether Q-411 was
  a 40% gain or a small regression.
- **Q-413** — back-fill yesterday's dinner on the APK while offline and confirm the row shows the
  window midpoint, before and after it syncs.
- **Q-412** — reassign a meal type with logs and confirm on the APK that the entries appear under the
  new type with the same calories and survive a restart.
- **Q-405** — swap a compound for an isolation and watch the *prescribed sets* change, not just the
  role.
- **Q-310** — confirm at the next engine-chosen deload: header "Deload", reduced weights, no PR badge.

## Claimed paths

- **`lib/media/`** and **`android/app/src/main/java/com/trainingai/app/media/`** — new this session
  (Q-400's gallery bridge). Engine/native, Lane A's.
- **`lib/net/`** (`safe-fetch.ts`) — inherited, still Lane A's.
- `app/api/admin/vacuum/`, `app/api/oura-ble/rekey/`,
  `lib/data/postgres/slices/oura-raw-{frames,pack}.ts` — inherited, still Lane A's.
- **`components/nutrition/meal-label-*`** was touched this session for Q-400 because that entry
  assigns the whole item to Lane A. It is otherwise **Lane B's**; hand it back.

## Findings recorded, so they are not re-derived

**From this session:**

- **A stale local database produces failures that look like code defects.** `setup.sh` will not
  re-seed a non-empty DB, so one seeded days ago holds history ending days ago, and a "today"
  assertion fails locally while passing in CI (which builds a fresh Postgres every run). This is now
  in `CLAUDE.md`; the check is `SELECT max(date) FROM body_metrics WHERE steps IS NOT NULL`, and
  re-seeding means dropping `/var/lib/postgresql/local-dev` — `pnpm db:local` alone will not.
- **`npx next lint --dir app` is NOT `pnpm lint`.** Different runner, different ruleset; the first
  reported warnings only while CI failed on a `prefer-const` error. **`pnpm ci:local` is the gate.**
- **`computeActiveEnergy` cannot run in this sandbox at all** — it reads a vendored model constants
  file object storage will not serve, so any complete-profile `energy-balance` request 500s here,
  **on `main` too**. Do not diagnose it as your change.
- **A conflicted doc-size baseline must be RE-MEASURED, never picked.** Two branches raised the
  backlog baseline to 11220 and 11222; the correct merged value was **11197** — lower than both,
  because a removal landed in between.
- **The baseline conflict resolver keeps only one side's header prose.** After running it on
  `check-bounded-request-body.js`, hand-check that every `// N:` slice-log line survived; three were
  lost or missing across the sweep.
- **`createMissingExercise` is admin-gated**, so a Coach test that swaps to an uncatalogued exercise
  needs `is_admin` on its user. That gate is also how the owner reached the Q-405 path.
- **Drizzle will not marshal a JS array into `unnest(...)`** in a raw `sql` template — it arrives as
  a malformed array literal. Use per-row updates or build the literal explicitly.
- **A backtick inside a SQL comment nested in a template literal is a parse error.** Cost one
  round-trip on Q-325.
- **Whole-gram rounding is coarse for fat** (9 kcal/g), so a macro-ratio assertion needs a 0.05
  tolerance, not 0.005. Pin the exact arithmetic with numbers that divide cleanly instead.
- **Exercise-role classification: the signal is TOTAL muscle count, not `main` count.** 117 of 142
  catalogue entries carry exactly one `main` muscle, Barbell Bench Press among them. Validated across
  all 142 rows — 16 primary / 39 secondary / 86 accessory / 1 unrecommendable, with the barbell curls
  correctly in accessory. Known imprecision: Plank, Side Plank and Mountain Climbers read as
  `secondary`; demoting bodyweight wholesale would break Pull-Up and Chin-Up, so the trade stands.

**Inherited and still true:**

- **All raw-frame reads go through `lib/data/postgres/slices/oura-raw-frames.ts`.** A hot-only read
  silently returns a 7-day history and raises nothing.
- **An aggregate cannot use that reader's dedupe** — count via an anti-join on `(epoch, tag, ds_bucket)`.
- **`oura_raw_samples.measured_at` and `event_name` are DEAD COLUMNS.** Do not add a reader; dropping
  them is data-dropping and owner-gated.
- **A ds regression is NOT evidence of a ring-clock reset** (Q-314). A re-drain produces one.
- **The `VACUUM FULL` allowlist is a safety boundary, not validation.** `hasOwnProperty`, never `in`.
- **DNS rebinding is NOT closed out in `fetchPublicUrl`.** The address is validated and then the
  hostname is connected to by name; closing it needs a pinned-IP connection undici does not expose.
