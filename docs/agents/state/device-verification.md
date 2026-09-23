# 📱 Device Verification — baton

> **Successor sessions are titled `📱 Device Verification Agent 🟢`** — exactly, emoji included —
> and are opened **locally** by the owner in the desktop app on the machine the S25 is plugged into.
> `create_session` makes a cloud session, which cannot reach the phone.

**Updated:** 2026-09-23 · **By:** the first-run session (`device/probe-sitting-2`) · **Next ID:** `DV-7`
(`grep -rhoE '\bDV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## For the Orchestrator — read this part

- **Assign me work with `Lane: DV`** (OR-129); I read `--lane DV` first, then `--sittings`.
- Open from sitting 1: **BF-177 FAILED** (B, READY), **DV-4** (B), **DV-5** (A), **DV-6** (B, owner).
- **Sitting 2 was stopped by an incident I caused:** blind `adb input` taps landed outside the app,
  opened another app and closed this one on the owner's phone. Raw input now goes only through the
  guarded `rawTap`/`rawSwipe` (foreground + path checked immediately before sending).

## Now

Nothing running. The phone is the owner's to use; I message him before the next sitting.

## Next — sitting 3, in this order

1. `probe.js`, then **check whether the shell mounts two tab bars after a cold reload** — sitting 2's
   census crashed on `nav a[href="/"]` matching two elements. Not yet a finding.
2. **RV-133's 30-minute idle** (`census.js --rounds 1 --idle-min 30`) with `keyevent 224` every 4 min.
3. **P1/P2 remaining writes** — weigh-in (+ RV-126's RV-108 question), supplement tick, mood,
   activity confirm; each undone straight after.
4. **BF-61's immediate tap** — only with `rawSwipe`/`rawTap`, from a tray verified at
   `translateX(0)`, tapping Delete's own rect. Read the entry's sitting-2 bullet first.
5. P5/P6 (`record.js`), P9, RV-130's resume half; then `--sittings` (110) by queue order.

## Blocked — on the owner

- **Airplane mode** for RV-131's restart-offline half. **DV-6** — scrim or not.

## Standing permissions from the owner (2026-09-23)

- **All five write types, each undone straight after:** food, supplement tick, mood check-in,
  weigh-in, activity confirm. **Workouts** may be started; delete anything logged.
- **Upgrade tooling on this machine yourself.** Leave other agents' PRs for them to close.

## Decided — do not re-litigate

- **No raw `adb input tap|swipe` outside `rawTap`/`rawSwipe`.** The phone is the owner's.
- **`e2e/**` does not run on the phone**; Playwright is this role's driver (`pw.js`).
- **A request count lies for local-first screens** — read the visible number too (BF-177).
- **Captures never leave this machine as images** — the repo is public.

## Claimed paths

`scripts/device/**` — mine for good (the role owns the harness).
