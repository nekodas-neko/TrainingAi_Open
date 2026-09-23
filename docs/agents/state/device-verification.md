# 📱 Device Verification — baton

> **Successor sessions are titled `📱 Device Verification Agent 🟢`** — exactly, emoji included —
> and are opened **locally** by the owner in the desktop app on the machine the S25 is plugged into.
> `create_session` makes a cloud session, which cannot reach the phone.

**Updated:** 2026-09-23 · **By:** the first-run session (`device/sweep-prep`) · **Next ID:** `DV-7`
(`grep -rhoE '\bDV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## For the Orchestrator — read this part

- **Assign me work with `Lane: DV`** (OR-129); I read `--lane DV` first, then `--sittings`.
- **Sweep 1 is planned, not run:** `docs/device-sweep-1-plan.md` — all 116 owed checks read and
  bucketed (53 automatable, 9 approved writes, 9 writes needing the owner, 18 hardware, 6 judgement,
  21 not really device checks), plus P11–P16 (RV-137…142). **Stale for your sweep:** BF-107 and
  LA-57 print as owed but are closed/refuted; BF-95's failure note reads like BF-61's.
- Open from sitting 1: **BF-177** (B), **DV-4** (B), **DV-5** (A), **DV-6** (B, owner-gated).

## Now

Waiting on the owner's go-ahead **and** his four decisions (plan §"Decisions"): weigh-in overwrite,
mood one-per-day, the nine unapproved writes (default skip), the optional owner-present OS block.

## Next — sweep 1, in the plan's order

Setup → cold start (`perf.js coldstart`, `longtasks`) → distribution (`perf.js cycles --n 10`,
`backstack`) → frames/paint/census → screens (AUTO rows) → writes → admin → resume → owner block →
long session (`perf.js tti` at open/walk/idle around `census.js --idle-min 30`). About 3 hours.
First check at setup: **two tab bars after a cold reload?** (sitting 2's census crashed on it).

## Rules for every message and every input

- **Lead every message with 🟢 (phone may be unplugged) or 🔴 (plug in / leave plugged).**
- **No raw `adb shell input` outside `rawTap`/`rawSwipe`; `back()` refuses off-foreground.**
- **Wake key `keyevent 224` every 4 min during idle stretches** — the screen sleeps at 5 min.

## Standing permissions from the owner (2026-09-23)

- **Five write types, each undone straight after:** food, supplement tick, mood check-in,
  weigh-in, activity confirm — but see the weigh-in and mood caveats in the plan.
  **Workouts** may be started; delete anything logged. **Tooling upgrades** on this machine: yes.

## Decided — do not re-litigate

- **`e2e/**` does not run on the phone**; Playwright is this role's driver (`pw.js`).
- **A request count lies for local-first screens** — read the visible number too (BF-177).
- **Captures never leave this machine as images** — the repo is public.

## Claimed paths

`scripts/device/**` — mine for good (the role owns the harness).
