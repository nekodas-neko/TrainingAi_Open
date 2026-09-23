# 2026-09-23 — Device sweep 2: nine entries closed, an outage, a stuck deploy, and a food that came back

**Branch:** `device/sweep-2b` · **Agent:** Device Verification · **Docs + `scripts/device/**`.**

S25 Ultra, APK 1.460.4, owner's account, **three-button navigation** (`navigation_mode` 0, so every
gesture-inset check was void). Stations C–G ran on web v1.465.10. Station A and the rechecks ran on
**v1.465.16** after production caught up and the app was restarted. Plan: `docs/device-sweep-2-plan.md`.
The phone showed 🔴 throughout and 🟢 at the end.

## The pause: production went down, then turned out not to be deploying

- **DV-13.** Opening `/admin/oura-ble` left four admin requests (`device-metrics`, `samples/summary`,
  `rollup-state`, `samples/pack`) unanswered for more than 90 s. The public `/api/version` then timed
  out from a separate PC from **20:04 to 20:12 AEST**. The sweep stopped and the endpoints were not
  re-requested. The cause is **not proven**.
- **DV-14.** While re-checking, production was found on **v1.465.10** while `main` was at 1.465.16:
  six merges since 18:16 had not deployed, one of them at 20:03, a minute before the outage. By
  ~20:27 production had **caught up on its own**. Why is unknown; Railway's deploy log is the first
  step. Something that stopped is not something that was fixed.

## Results

| verdict | entries |
|---|---|
| **Verified, removed from the backlog** | Q-112e, BF-99, BF-162, RV-39, Q-317, BF-133, BF-186, BF-45, BF-47 (+ 5 Known-Issues rows archived: BF-162, Q-112e, BF-133, RV-39, BF-47) |
| **Device half passes, other work still owed** | TN-35, Q-519, OR-116 (both labels), Q-274, BF-163, BF-167, Q-538, BF-5 (page half), BF-175, BF-170, BF-98, RV-108 (2 of 3 keys), DV-11 (names present; TalkBack not run), DV-6 (controller works; the look is the owner's) |
| **Fails on the device** | **BF-177** (still, after #1467 deployed: 8 s with no change until the next action), **RV-103** (blocked refetch shows a stale number, no failure line), **RV-111** (one back from the scanner closes the whole Log Food flow), **TN-53** (0-value HRR points), **RV-127** (~33 px touch area) |
| **Could not check** | Q-281 (no "Final readiness" row), RV-37 (three-button nav), PS-35b failure state, RV-38 (SW fetch), Q-544 / Q-316 / BF-10 (admin requests never answered; DV-13) |
| **Not reproduced** | BF-179: that morning's 52% was a fresh prescription with a check-in reason |

## New: DV-15, a deleted food came back as `synced`

A test food logged and deleted within ~10 s reappeared locally: `deleted_at NULL`, `sync_status
'synced'`, and an `updated_at` stamped as a pull was being applied. Meanwhile the server's list no
longer held it. It stayed on screen through tab swaps. A second, traced delete worked. Filed for
Lane A with the suspected race (a pull applied after the push confirmed the delete) marked as **not
established**.

## Writes (all undone)

Cocoa powder logged and deleted four times (online and offline); Fish Oil ticked and unticked; a
same-value weigh-in (69.4 kg). The weigh-in leaves today's weight **manual-sourced**, which outranks
a later scale reading today.

## Harness

- `recordNetwork({ bodies: true })` now works (it threw before).
- Runbook: `food-logs` returns a bare array; use CDP `Network.setBlockedURLs` for SW-fetched
  requests; `/health/day` query artifact; check `navigation_mode` first; restart the app after a
  deploy before re-checking a fix.

## Not exercised

Gesture-nav insets, TalkBack, the light theme, the admin console after DV-13, and the station A–H
items listed as carried forward in the baton (`docs/agents/state/device-verification.md`).
