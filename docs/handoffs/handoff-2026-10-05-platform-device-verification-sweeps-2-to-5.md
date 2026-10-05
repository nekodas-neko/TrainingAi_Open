# Handoff — 2026-10-05 · Device verification, sweeps 2 to 5

_Domain: `platform` (also touches `app-shell`, `nutrition`, `devices`, `workouts`) · Branch:
`device/wrap-up` · PR: the wrap-up PR. Every sweep PR is merged: #1471, #1476, #1491, #1659, #1681,
#1691, #1696, #1701, #1702 and #2036._

> **Read first:** `projectOverview.md`, then [`docs/agents/README.md`](../agents/README.md) (the DV
> role), then the baton [`docs/agents/state/device-verification.md`](../archive/agents-2026-10-05/state/device-verification.md),
> then the current plan [`docs/device-sweep-5-plan.md`](../device-sweep-5-plan.md). This file
> covers what this session did and leaves behind; the findings themselves live on their backlog
> entries.

## Goal

Run the owner's Samsung S25 (the APK, a WebView of the Railway app) from this Windows PC over adb
and Chrome DevTools, and answer device checks that no sandbox can reach. Each check gets
VERIFIED, FAILED or COULD NOT CHECK. A pass leaves the queue, and a fail goes back to the lane that
owns the surface.

## Current status

- **The phone is not connected** and nothing is running. It runs **APK 1.465.52** on **gesture
  navigation**. The latest published APK is **1.481.3**, and installing it is an open owner decision.
- `main` and prod are on **v1.486.11**.
- The harness self-test passes **22 of 22** (`node scripts/device/selftest.js`).
- **Not exercised in any sweep:**
  - TalkBack and reduce-motion;
  - real airplane mode;
  - overnight and midnight rollover;
  - a workout completed during a sitting;
  - the Colmi ring, H10 strap and scale;
  - `/admin/oura-ble` (DV-13);
  - a no-cache cold start.

## What shipped (sweeps 2 → 4b, 2026-09-23 → 2026-09-26)

| sweep | PR | headline |
|---|---|---|
| 2 | #1471 | 9 entries verified and closed. Filed **DV-13** (an 8-minute prod outage while the BLE admin console's requests hung), **DV-14** (deploy stuck for 2 h), **DV-15** (deleted food resurrected locally) |
| 3 | #1476 plan, #1491 | RV-128 measured a 58–109 ms tab-switch blank, and RV-129 found Nutrition's meal-plan skeleton. Filed **DV-16** (phantom *Leave workout?*), **DV-17**, **DV-18** (broken admin image). Fixed a test that main had turned red (keep-gate tripwire) |
| 4 plan | #1659, #1681, #1691 | review of 33 DV entries, two sittings planned |
| 4a | #1696 | 10 closed: DV-16, DV-17, BF-177, RV-111, LB-140, RV-145, OR-127, RV-149, RV-152, and BF-92 (Sentry event `ac94c00fa3e3469f87c8509eae6b7907`). **OR-162** named the two *Heart rate · today* charts behind DV-12. Filed **DV-19** (one walk stored as three rows). The owner-approved Q-11 backfill ran and filled nothing |
| 4b | #1701, #1702 | 5 closed: DV-2, BF-165, RV-37, RV-127, RV-125. **DV-8 is common**: 36 food-delete tombstones stuck `pending`. No `health-alerts` notification channel (since fixed as DV-21). RV-206's read-only probes ran |
| 5 plan | #2036 | six 45–60 minute sittings plus a held redecode sitting; supersedes the Orchestrator's 2026-09-28 plan |

**Harness changes** (`scripts/device/**`, all merged):
- `rawSwipeThenTap`, a guarded swipe and tap in one shell call;
- `recordNetwork({ bodies: true })`;
- `cdp.js` `findSocket` now matches the app's live pid — a stale socket broke every attach after a
  force-stop;
- runbook sections for sweeps 2, 3, 4a and 4b in `scripts/device/README.md`.

**The private design gallery** for RV-205/206 is
<https://claude.ai/artifact/6chic4wxSBEC6maezNXdGS> (v3, 75 captures and 16 measurement rows). It is
the owner's only. Captures never go in the repo.

## Deliberately NOT done

- **The full-history redecode.** One run would answer seven entries (LA-171②, LA-68, Q-525, TN-1,
  Q-71, LA-56, RV-169). But no full pass has completed since 2026-08-17, and the attempts starve the
  process. It is held until Lane A says it can finish.
- **`/admin/oura-ble` was never reopened after DV-13.** The row cap and per-request timeout have not
  shipped.
- **TN-62 and BF-13** were not run in these sweeps. Both are authorised and are sitting 2 of the
  sweep 5 plan, BF-13 first.

## Key decisions (with rationale)

- **Every test write is undone, and the server is checked after.** That is the owner's standing
  rule. A deleted food is always re-read locally, which is how DV-15 and DV-8 were found.
- **Production watch on every sitting.** `/api/version` is polled every 30 s, and an answer over 5 s
  stops the sweep. This came out of DV-13.
- **Writes outside the standing set are asked for, never assumed.** Q-11, LA-126 and RV-206's
  settings probes were each approved explicitly. The entries record the approvals.
- **Screenshots of the owner's data go only to a private Artifact.** The repo is public.

## Gotchas / what did NOT work

- **Three-button navigation reports every safe-area inset as 0.** Check `navigation_mode` (2 means
  gesture) before any clearance verdict.
- **With gesture navigation on, a raw swipe starting at x < ~24 px is Android's back gesture.** Start
  swipes at x ≥ 100. This sent the app Home twice.
- **A `requestAnimationFrame` sampler outlives its script**, since reloads are banned. Use a token.
- **`recordNetwork`'s `t` is relative to recording start.**
- **`/api/nutrition/food-logs` returns a bare array.**
- **`page.route` cannot see service-worker fetches; `Network.setBlockedURLs` can.**
- **CDP `Input.synthesizeScrollGesture` hangs on this WebView.** Use adb flings.
- **Screencast latency is noisy** while the dynamic background animates.
- **A card's own description text can match a "done" regex.** Watch the result element instead.
- **The Workout tab can trap the harness with *Leave workout?*.** Press *Stay* and leave via `go()`.
- **Read the active panel (`[data-tab-active="true"]`), not the document.** The persistent tab shell
  keeps every tab mounted.

## Files to look at

- `docs/device-sweep-5-plan.md` — the next work, in order.
- `docs/agents/state/device-verification.md` — the baton (state and rules).
- `scripts/device/README.md` — the runbook and every lesson above in full.
- `scripts/device/pw.js`, `scripts/device/cdp.js`, `scripts/device/perf.js` — the harness.
- `docs/device-agent-probe-checklist.md` Parts D–E — RV-205 and RV-206's probes.

## Open questions / blockers

- **The owner:** install APK 1.481.3? Five owed checks need ≥ 1.478. The recommendation is yes;
  `adb install -r` keeps the data and the ring key.
- **Lane A:**
  - DV-13's row cap and timeout;
  - whether the full-history redecode can now complete;
  - RV-186 ②③⑤, RV-153 and the RV-103 follow-on are all unfixed.

## Pickup prompt

```
You are the 📱 Device Verification Agent for TrainingAI, running LOCALLY on the owner's Windows PC
(D:\Projects\TrainingAi_Open) with his Samsung S25 on USB. Keep the session title
"📱 Device Verification Agent 🟢" and lead every reply with 🟢 (phone may be unplugged) or 🔴 (plug
in / leave plugged).

1. git fetch origin main && git checkout -B device/<work> origin/main
2. Read, in order: projectOverview.md · docs/agents/README.md (the DV role) ·
   docs/agents/state/device-verification.md (your baton) · docs/device-sweep-5-plan.md ·
   docs/handoffs/handoff-2026-10-05-platform-device-verification-sweeps-2-to-5.md ·
   scripts/device/README.md (the runbook).
3. Run `node scripts/next-item.js --lane DV --all` and `--sittings`; reconcile against the sweep 5
   plan (the queue moves).
4. First action: ask the owner whether to install APK 1.481.3 (phone is on 1.465.52), then ask him
   to plug in, and run Sitting 1 of docs/device-sweep-5-plan.md.

Constraints that bind: never uninstall or clear app data (destroys the ring key); never open
/admin/oura-ble until DV-13 closes; never page.reload(); raw input only via pw.js
rawTap/rawSwipe/rawSwipeThenTap, starting swipes at x ≥ 100; poll /api/version every 30 s and stop
on >5 s; every test write undone and re-read; captures never in the repo (private Artifact only);
production recomputes dry-run first, one at a time, by fetch. PRs are yours to merge once CI is
green (enable auto-merge right after opening); never merge a PR you did not author.
```
