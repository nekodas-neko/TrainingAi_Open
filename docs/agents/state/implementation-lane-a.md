# Implementation Agent (A) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (A) 🚧`** — exactly, emoji included. The title
> is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a
> perfect baton.

**Updated:** 2026-08-20 (later) · **By:** the sixth session to run as Lane A · **Next ID:** `LA-18`
(`grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line)
**Migrations:** through 206; next free is **207**. Local SQLite **v28**, untouched this session.

## Now

**Nothing is in flight.** Every branch this session opened is merged. Start with
`node scripts/next-item.js --lane A`.

**But read this before taking the top item: the Lane A queue is thin right now, and the top three are
each blocked in a way the tool cannot show.** Checked 2026-08-20:

- **LA-16** (top) is real work and is mine — three ratchets converted, three left. The two remaining
  script conversions are a brace-matching refactor each, and `check-strict-request-schemas` is
  **unread**. One per PR, each proven both ways; these are gates.
- **Q-324** has nothing to build. Its mechanism half shipped; the timeout it was filed for did not
  reproduce. It is waiting on *evidence*, and the useful contribution is a fresh-DB suite run recorded
  on the entry — not a fix.
- **Q-555** is **undiagnosed by its own text** (*"whether the no-op is Next's router aborting a failed
  RSC fetch or the click handler swallowing it"*) and needs a device check. Do not build it blind.

Below those: **Q-499**, then the nutrition cluster — most of which is Lane B's, correctly, as of #289.

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

#270 PS-3 · #274 Q-331 · #278 RV-32+34 · #280 RV-33 · #281 Q-362a (**additive** — LA-15 contracts it
after Q-362b) · #282 Q-424 · #283 Q-421 · #284 baton · #285 LA-13 · #286 LA-14 **refuted, no code** ·
#287 LA-17 · #288 LA-16 half · #289 lane tags. Narrative is in each PR body and journal entry.

**The queue itself changed in #289 and every agent is affected.** `next-item.js` had been taking the
first `Lane`-shaped string in an entry's body, and the commonest shape here is a banner reading *"the
Lane A half SHIPPED — what is left is Lane B"*. **Eight of Lane A's top ten READY items were Lane
B's.** Nineteen entries now carry an explicit `Lane:` field; three are `?` because they are genuine
A/B splits and resolving those is Orchestrator's. Where a blocker was stated in prose only, it is now
a `Needs:` field (Q-556 → Q-328, Q-407 → Q-398).

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
- **Extracting a helper for testability without switching the caller over is worse than not
  extracting it.** `laneFromLines` was used only by its own test while `next-item.js` kept an inline
  copy; they drifted within a day, so the test was testing a function the tool did not call.
- **Green does not prove a CI-only path ran.** #285's replay could have replayed nothing and still
  exited 0. It now fails when it re-ran nothing. Needing to read a log to know whether a check checked
  anything *is* the defect.
- **A check that adds a network call adds a way to fail.** Q-424's base fetch went red on a blip; it
  is `|| true` now, because the fallback is stricter, not weaker.
- **Smaller costs:** `psql -tAc` output carries a trailing newline (a URL built from it makes `curl`
  return `000`); `fmtAest` strings do not sort (`"5:00pm" < "9:00am"`).

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

*Inherited, and none is recorded elsewhere. They are durable knowledge rather than state — the next
handoff should move them out (Oura → `docs/oura-ble-operations.md`) instead of carrying them again.*

- **Raw frames:** read only via `slices/oura-raw-frames.ts` (a hot-only read silently returns 7 days);
  an aggregate cannot use its dedupe — anti-join on `(epoch, tag, ds_bucket)`.
  `oura_raw_samples.measured_at` and `event_name` are **dead columns**, owner-gated to drop. A ds
  regression is **not** a ring-clock reset (Q-314) — a re-drain makes one.
- **Security:** the `VACUUM FULL` allowlist is a boundary, not validation — `hasOwnProperty`, never
  `in`. **DNS rebinding is NOT closed in `fetchPublicUrl`**: the address is validated, then the
  hostname is connected to by name; closing it needs a pinned-IP connect undici does not expose.
- **Sandbox limits:** `computeActiveEnergy` cannot run here via a complete-profile `energy-balance`
  request (a vendored constants file object storage will not serve) — true on `main` too. A stale
  local DB looks like a code defect: `setup.sh` will not re-seed a non-empty one, drop
  `/var/lib/postgresql/local-dev`. `npx next lint` is **not** `pnpm lint`. Drizzle will not marshal a
  JS array into `unnest(...)` in a raw `sql` template.
