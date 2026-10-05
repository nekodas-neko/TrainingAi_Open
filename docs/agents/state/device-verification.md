# 📱 Device Verification — baton

> **Successor sessions are titled `📱 Device Verification Agent 🟢`** — exactly, emoji included —
> and are opened **locally** by the owner in the desktop app on the machine the S25 is plugged into.
> `create_session` makes a cloud session, which cannot reach the phone.

**Updated:** 2026-10-05 · **By:** the sweeps-2-to-5 session, at its wrap-up · **Next ID:** `DV-23`
(`grep -rhoE '\bDV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## For the Orchestrator — read this part

- **Assign me work with `Lane: DV`** (OR-129); I read `--lane DV` first, then `--sittings`.
- **The current plan is [`docs/device-sweep-5-plan.md`](../../device-sweep-5-plan.md)** (2026-10-05).
  It has six 45–60 min sittings, failure-first, and supersedes the 2026-09-28 sitting plan.
- **The session narrative is
  [`handoff-2026-10-05-platform-device-verification-sweeps-2-to-5`](../../handoffs/handoff-2026-10-05-platform-device-verification-sweeps-2-to-5.md)**
  (sweeps 2 → 4b, the harness, every trap).
- **Waiting on Lane A:**
  - DV-13's row cap and timeout (the console stays closed until then);
  - whether the full-history redecode can finish (it would answer 7 entries);
  - the fixes for RV-186 ②③⑤, RV-153 and the RV-103 follow-on.

**Now:** nothing running. The phone is the owner's: gesture nav, **APK 1.465.52**. Latest is
1.481.3, and installing it is his call. I recommend yes.

## Next

Sitting 1 of the sweep 5 plan: BF-61's instrumented probe, DV-12/OR-162, DV-8 (expect 0 stuck
tombstones), the walk clean-up (DV-19 / LA-171 ③ / BF-191 ①), DV-21's channels, and BF-22. Then
sitting 2's recomputes in this order: LA-126, BF-13 → TN-62, LA-171 ①.

## Rules for every message and every input

- **Lead every message with 🟢 (phone may be unplugged) or 🔴 (plug in / leave plugged).**
- **No raw `adb shell input` outside `rawTap`/`rawSwipe`/`rawSwipeThenTap`; `back()` refuses off-foreground.**
- **Wake with `keyevent 224` every 4 min; bring the app forward with `am start` (never a tap); use `MSYS_NO_PATHCONV=1`.**
- **Poll prod `/api/version` every 30 s during a sweep, and stop on any answer over 5 s. Never open
  `/admin/oura-ble` until DV-13 closes; never `page.reload()`. Never press *Leave* on the workout dialog.**
- **With gesture nav on, start raw swipes at x ≥ 100.** Under ~24 px is Android's back gesture.

**Standing permissions (owner):** writes, each undone straight after — food, supplement tick,
weigh-in (today's own value), mood (restore it), activity confirm, throwaway create/delete,
start-and-leave a workout. Also approved: RV-206's P29/P30/P31 settings probes (2026-09-26, restore
each) and the LA-126 targets write (2026-09-28). **Only what a check needs.** Tooling upgrades: yes.

## Decided — do not re-litigate

- **`e2e/**` does not run on the phone**; Playwright is this role's driver (`pw.js`).
- **`/api/workout-sessions/day`'s `sessionId` is the PROGRAM session**, not a workout id.
- **A request count lies for local-first screens.** Read the visible number too.
- **`/api/nutrition/food-logs` returns a bare ARRAY.** Block service-worker fetches with
  `Network.setBlockedURLs`.
- **Re-read the local row after any food delete** (DV-15, DV-8).
- **Captures never leave this machine as images**, except into the owner's private Artifact (RV-205).

**Claimed paths:** `scripts/device/**` — mine for good (the role owns the harness).
