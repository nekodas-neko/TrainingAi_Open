# 📱 Device Verification — baton

> **Successor sessions are titled `📱 Device Verification Agent 🟢`** — exactly, emoji included —
> and are opened **locally** by the owner in the desktop app on the machine the S25 is plugged into.
> `create_session` makes a cloud session, which cannot reach the phone.

**Updated:** 2026-09-23 · **By:** the first-run session (`device/bf166-mid-workout`) · **Next ID:** `DV-3`
(`grep -rhoE '\bDV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## For the Orchestrator — read this part

- **I take every device check you scope.** Put a sitting in a `Batch:` and it is mine to run; tell
  the owner only what needs a human (wearing, weighing, feel, a production write he has not OK'd).
- **The phone is on GESTURE navigation now** (owner, 2026-09-23; `probe.js` reads mode 2, bottom
  inset **15px**). Safe-area checks are valid from here on.
- **`back-gesture-sitting` is done on the device side.** All five checks answered; what remains in
  that batch is build work for Lane B — **BF-165** and **DV-2**, one mechanism.
- **Leave PR #1411 alone** — the owner wants the Orchestrator to close its own PR. Its content is
  already in `main` via #1417.

## Now

Nothing in flight once `device/bf166-mid-workout` merges. Results so far (web v1.465.4, APK 1.460.4):

| entry | outcome |
|---|---|
| LA-109, LB-107, BF-100 | ✅ VERIFIED, removed (#1417) |
| BF-166 | ✅ VERIFIED in full, removed — the mid-workout half ran on 2026-09-23 with the owner's OK |
| BF-165 | ❌ reproduced — sheet's `back()` 7 ms after the push. READY, Lane B |
| BF-111 | ❌ "built 23 Aug" is the release's `published_at`. Lane A |
| DV-2 | ❌ new — *Leave* on "Leave workout?" stays on the session screen. Lane B, batched with BF-165 |
| DV-1 | Lane O — Windows rule-script paths. **Node half fixed here** (22.23.2) |

## Next — in this order

1. **Safe-area sweep, as one pass** — now valid. `tour.js` computes per-screen clearance; it has
   **not run on the device yet**, so expect to fix it first. Floored utilities vs a 15px inset.
2. **Offline-first reads** — needs airplane mode; ask the owner to toggle it (a system setting).
3. **`admin-console-sitting`** (7) and **devices** (10) — read-only buttons first; anything that
   re-keys, re-pairs or syncs → ask.
4. **`motion-polish`** via `record.js` (RV-74/75) — also not yet run on the device.

## Blocked — on the owner

- **`e2e/**` on the phone** — `connectOverCDP` attaches, but the specs write into production. A
  read-only allowlist, or a test account on the phone? Not yet answered.

## Standing permissions from the owner

- **A workout may be started for a check, provided it is deleted afterwards.** Starting alone
  writes nothing server-side; only a logged set (`workout_log`) or completion does. Verify with
  `/api/workout-sessions/day?date=<today>` afterwards; if a set was logged, delete that session.
- **Upgrade tooling on this machine yourself** (Node was done this way via winget).

## Claimed paths

`scripts/device/**` — mine for good (the role owns the harness).

## Do not re-litigate

- **Start Workout runs a 3-second countdown** before the store leaves `pre`; a back during it
  just leaves the screen. Wait for `mode` to change before testing anything mid-workout.
- **Two back presses to close `/program`'s New Program sheet is correct** — the first closes the
  keyboard the autofocused field raised.
- **Captures never leave this machine as images** — the repo is public.
