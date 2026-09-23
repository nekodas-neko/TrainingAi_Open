# 📱 Device Verification — baton

> **Successor sessions are titled `📱 Device Verification Agent 🟢`** — exactly, emoji included —
> and are opened **locally** by the owner in the desktop app on the machine the S25 is plugged into.
> `create_session` makes a cloud session, which cannot reach the phone.

**Updated:** 2026-09-23 · **By:** the first-run session (`device/probe-tooling`) · **Next ID:** `DV-4`
(`grep -rhoE '\bDV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## For the Orchestrator — read this part

- **Assign me work with `Lane: DV`** (OR-129); I read `--lane DV` first, then `--sittings`. Tell the
  owner only what needs a human (wearing, weighing, feel).
- **Next sitting is Review's probe set, RV-124…RV-133** (`docs/device-agent-probe-checklist.md`),
  then the ~80 owed checks that need no human. Tooling for it landed on this branch.
- **The phone is unplugged between sittings.** I message the owner to connect it; nothing runs
  on a timer.

## Now

No sitting in flight. Tooling built and self-tested off-phone: `scripts/device/pw.js` (Playwright
over the WebView socket), `sweep.js` (P4), `census.js` (P2/P7/P10), `selftest.js` (18/18 against a
desktop Chrome). **None of the new tools has touched the phone yet** — expect a fix on first run.

Open results: BF-165 + DV-2 (Lane B, one mechanism), BF-111 (Lane A), DV-1 (Lane O, Windows
rule-script paths — Node half fixed here), DV-3 (Lane A, migration-163 test flake).

## Next — the sitting, in this order

1. `probe.js` (confirm gesture nav), `selftest.js`, then `sweep.js` — P4, RV-127.
2. `census.js --rounds 2 --dwell 25` — P2/P7/P10, RV-125/130/133. Then `--idle-min 30`.
3. P1 matrix (RV-124) with `watchAfter`, then P3 (RV-126) with `localQuery`, then P8 (RV-131)
   with `offline(true)` — all with the writes below, each deleted straight after.
4. P5/P6 with `record.js` (RV-128/129), P9 (RV-132).
5. The owed checks by queue order (`--sittings`), look-and-feel left to the owner.

## Standing permissions from the owner (2026-09-23)

- **All five write types, each deleted/undone straight after:** log a food, tick a supplement,
  log a mood check-in, save a weigh-in, confirm a detected activity.
- **A workout may be started** for a check, deleted afterwards if anything was logged (starting
  alone writes nothing; verify with `/api/workout-sessions/day?date=<today>`).
- **Upgrade tooling on this machine yourself.** Leave other agents' PRs for them to close.

## Decided — do not re-litigate

- **The existing `e2e/**` suite does not run on the phone**: 62 of 121 specs use the local DB,
  ~80 assume the seeded account, and the suite signs in — which would sign the owner out, and
  sign-out wipes the device. Playwright is used as *this role's driver* instead. A small
  phone-only read-only regression pack is optional, after the probes.
- **Start Workout runs a 3-second countdown** before the store leaves `pre`.
- **Captures never leave this machine as images** — the repo is public.

## Claimed paths

`scripts/device/**` — mine for good (the role owns the harness).
