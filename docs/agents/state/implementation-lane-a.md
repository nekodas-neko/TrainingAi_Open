# Implementation Agent (A) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (A) 🚧`** — exactly, emoji included. The title
> is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a
> perfect baton.

**Updated:** 2026-08-20 · **By:** the sixth session to run as Lane A · **Next ID:** `LA-17`
(`grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line)
**Migrations:** through 206; next free is **207**. Local SQLite **v28**, untouched this session.

## Now

**Nothing is in flight.** Every branch this session opened is merged. Start with
`node scripts/next-item.js --lane A` and take the top READY item.

**#124 (Q-479) is deliberately open and must NOT be merged.** Owner, verbatim: *"leave that as a known
issue for now - only admin will be me for a long time."* Do not re-implement it either.

## The habit that paid every single time this session

**Re-verify an entry's premise against current `main` before building it, and write down what you
checked.** Six items, and it changed the work on four of them:

| entry | what it said | what was true |
|---|---|---|
| **Q-331** | they agree, just add a test | they had **stopped** agreeing — #255 gave the day path an HR estimate and left the route on MET |
| **RV-34** | check supplied ids against the program's existing rows | that refuses **every** save from the workout builder, which mints a fresh UUID per session |
| **Q-421** | route (b) + a labelling clause | (b) owner-rejected, (a) shipped, half the rest done that morning — it was a Lane B item |
| **PS-3** | four migrations re-fail forever | production has all four recorded; local-only, and smaller than the framing |

## Shipped

**#270** PS-3 (four migrations made idempotent) · **#274** Q-331 (two surfaces, two formulas, one
session — now one `estSessionKcal`) · **#278** RV-32+RV-34 (client-supplied FKs into user-scoped
tables) · **#280** RV-33 (a correct refusal answered as an empty 500) · **#281** Q-362a (durations
keyed by name; shipped **additively** — LA-15 contracts it after Q-362b) · **#282** Q-424 (the ratchet
measured merge order) · **#283** Q-421's last Lane A clause + the lane-tag parser.

Full narrative in each PR body and journal entry; this list is orientation only.

## Standing constraints

- **The local gate is `pnpm check:rules`** — quote its `Ran N of N`, never the word "pass". It is
  **51 of 51** now: #282 added a base-branch fetch step. It was 50 this morning. Do not hardcode it.
- **`get_check_runs` is unreliable in both directions.** It read `total_count: 0` for 25 minutes on a
  PR whose base was current. **Attempting the merge is the authoritative check.**
- **Green CI is not proof a CI-only path ran.** #282's fetch step could have silently failed and the
  job would still be green, because the script falls back. Read the log when the change *is* the CI
  behaviour: it printed `[new branch] main -> origin/main`, which is the proof.
- **Fixture constants are synthetic.** Strength is activity 8 with `met_moderate: 0.6`, below
  `estWorkoutKcal`'s 1.5 floor — **every MET strength estimate is 0** in CI and the sandbox. Open any
  test touching it with a vacuity guard. `met_hard` is 3 and does clear the floor; activity 7
  (elliptical) clears it under both real and synthetic constants.
- **The HR estimator needs no MET table**, so an HR-path test is non-vacuous under fixtures. That is
  the way past the trap, not a workaround.
- **Nothing ran on the S25 this session.** Anything touching offline-first, native, safe-area,
  gestures or notifications needs the device smoke run or an explicit Known-Issues row.

## Traps this session walked into, so you do not

- **`git reset --soft origin/main` does NOT merge.** It moves HEAD and leaves the tree alone, so
  committing after it **reverts every file another PR landed in between**. Caught by diffing
  `--name-only` against `origin/main` before pushing; #275's two e2e files and a journal entry were
  about to be deleted. **Always diff against `origin/main` before you push.**
- **A rebase replays your conflict resolutions as new content.** Restacking nearly resurrected Q-423,
  which #273 had just refuted, because an earlier hunk resolution had carried its block. Rebuild a
  shared doc from `origin/main` and re-apply your own edit; never replay the hunk.
- **`git checkout -- <file>` after a mutation test discards uncommitted work.** Commit before mutation
  testing. Also: two files both named `route.ts` overwrite each other in a `basename`-keyed backup.
- **A count that moves further than your change explains is the bug.** A `next-item.js` fix hid 96 of
  203 entries from both lanes; nothing failed, `check:rules` was green, and the only tell was READY
  dropping 149 → 53. An entry stating no lane must be `null`, never `undefined`.
- **Smaller round-trip costs:** a `psql -tAc` value carries a trailing newline (a URL built from it
  makes `curl` return `000`), and `fmtAest` strings do not sort lexically (`"5:00pm" < "9:00am"`).

## The database reclaim is still the standing deadline item

Inherited unchanged for the fifth baton running, because **no session has been able to touch it**:

| Step | Worth | State |
|---|---|---|
| Migration **193** drops `idx_oura_raw_samples_user_measured` | **136 MB** | ✅ landed |
| Pack the raw frames (Q-541 Task 5 backfill) | **~630 MB** | ⛔ **needs a press against production** |
| `VACUUM FULL error_events` (Q-315) | **~49 MB** | ⛔ **needs a press against production** |

A sandbox session cannot authenticate to production (`CLAUDE_DB_QUERY_SECRET` is read-only,
`ADMIN_EXPORT_SECRET` is GET-only on one route). Either the owner runs the curls, or Lane B builds the
buttons (Q-316), or a **confirm-first** bearer path is added — **do not build the third without an
explicit yes, it is an auth change.** Runbook:
[`docs/handoff-2026-08-18-platform-database-reclaim.md`](../../handoff-2026-08-18-platform-database-reclaim.md).

## Waiting on the owner

- **Q-420** needs a decision on the 6–10 → 1–10 RPE scale mapping. **Q-422** is Tuning-originated:
  *Tuning proposes → owner signs off → Lane A implements*. Do not start it as Lane A.
- Two Sentry checks on-device; a Railway-dashboard reading for **Q-549**.
- Device checks owed and accumulating: **Q-400** (print once and measure — it also decides Q-411),
  **Q-413**, **Q-412**, **Q-405**, **Q-310**.

## Claimed paths

- **`scripts/lib/`** — new this session (`base-ref.js`, `lane.js`). Lane A's.
- `lib/media/`, `android/app/src/main/java/com/trainingai/app/media/`, `lib/net/safe-fetch.ts`,
  `app/api/admin/vacuum/`, `app/api/oura-ble/rekey/`,
  `lib/data/postgres/slices/oura-raw-{frames,pack}.ts` — inherited, still Lane A's.
- `components/nutrition/meal-label-*` is **Lane B's** — hand it back.

## Findings, so they are not re-derived

- **All raw-frame reads go through `lib/data/postgres/slices/oura-raw-frames.ts`.** A hot-only read
  silently returns a 7-day history and raises nothing. An aggregate cannot use its dedupe — count via
  an anti-join on `(epoch, tag, ds_bucket)`.
- **`oura_raw_samples.measured_at` and `event_name` are DEAD COLUMNS.** Dropping them is data-dropping
  and owner-gated.
- **A ds regression is NOT evidence of a ring-clock reset** (Q-314) — a re-drain produces one.
- **The `VACUUM FULL` allowlist is a safety boundary, not validation.** `hasOwnProperty`, never `in`.
- **DNS rebinding is NOT closed out in `fetchPublicUrl`** — the address is validated and then the
  hostname connected to by name; closing it needs a pinned-IP connection undici does not expose.
- **`computeActiveEnergy` cannot run in this sandbox** via a complete-profile `energy-balance`
  request — it reads a vendored constants file object storage will not serve. True on `main` too.
- **A stale local DB looks like a code defect** — `setup.sh` will not re-seed a non-empty one; drop
  `/var/lib/postgresql/local-dev`. **`npx next lint` is NOT `pnpm lint`.** **Drizzle will not marshal
  a JS array into `unnest(...)`** in a raw `sql` template.
