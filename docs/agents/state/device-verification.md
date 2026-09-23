# 📱 Device Verification — baton

> **Successor sessions are titled `📱 Device Verification Agent 🟢`** — exactly, emoji included —
> and are opened **locally** by the owner in the desktop app on the machine the S25 is plugged into.
> `create_session` makes a cloud session, which cannot reach the phone.

**Updated:** 2026-09-23 · **By:** the first-run session (`device/probe-sitting`) · **Next ID:** `DV-7`
(`grep -rhoE '\bDV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## For the Orchestrator — read this part

- **Assign me work with `Lane: DV`** (OR-129); I read `--lane DV` first, then `--sittings`.
- **Probe sitting 1 ran** (RV-124…133). Results are in each probe entry; Review converts them per
  its checklist. New work: **BF-177 FAILED** (Lane B, back in READY), **DV-4** (B), **DV-5** (A),
  **DV-6** (B, owner-gated). **BF-61 partial** — the immediate tap is still owed.
- **The phone disconnected mid-sitting.** I message the owner to reconnect; nothing runs on a timer.

## Now

Sitting 1 written up on `device/probe-sitting`. Every test write was deleted; the server shows no
Cocoa logs for 2026-09-23 and intake back at 434 kcal.

## Next — sitting 2, in this order

1. `probe.js`, then **RV-133's 30-minute idle** (`census.js --rounds 1 --idle-min 30`, phone untouched).
2. **P1/P2 with the remaining writes** — weigh-in (also RV-126's RV-108 question), supplement tick,
   mood check-in, activity confirm; `watchAfter` + visible numbers, each undone straight after.
3. **BF-61's immediate tap** — raw `adb shell input tap` 100–300 ms after the swipe, food + meals.
4. P5/P6 (`record.js`, RV-128/129), P9 (RV-132), RV-130's resume half.
5. Then the owed checks by queue order (`--sittings`, 110 now).

## Blocked — on the owner

- **Airplane mode** for RV-131's "survives a restart offline" half.
- **DV-6** — scrim behind the status bar, or not.

## Standing permissions from the owner (2026-09-23)

- **All five write types, each undone straight after:** food, supplement tick, mood check-in,
  weigh-in, activity confirm. **Workouts** may be started; delete anything logged.
- **Upgrade tooling on this machine yourself.** Leave other agents' PRs for them to close.

## Decided — do not re-litigate

- **`e2e/**` does not run on the phone** (62/121 specs use the local DB, the suite signs in and
  sign-out wipes the device). Playwright is this role's driver instead (`pw.js`).
- **A request count lies for local-first screens** — read the visible number too (BF-177).
- **Start Workout runs a 3-second countdown** before the store leaves `pre`.
- **Captures never leave this machine as images** — the repo is public.

## Claimed paths

`scripts/device/**` — mine for good (the role owns the harness).
