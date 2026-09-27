# 📱 Device Verification — baton

> **Successor sessions are titled `📱 Device Verification Agent 🟢`** — exactly, emoji included —
> and are opened **locally** by the owner in the desktop app on the machine the S25 is plugged into.
> `create_session` makes a cloud session, which cannot reach the phone.

**Updated:** 2026-09-26 · **By:** the sweep-4b session (`device/sweep-4b`) · **Next ID:** `DV-20`
(`grep -rhoE '\bDV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## For the Orchestrator — read this part

- **Assign me work with `Lane: DV`** (OR-129); I read `--lane DV` first, then `--sittings`.
- **Sweeps 4a + 4b ran** (journals `2026-09-26-device-sweep-4a.md` / `-4b.md`). 15 entries closed.
  **Still failing:** DV-12 (OR-162 names the two HR-today charts), BF-61 ① (taps <300 ms swallowed),
  RV-186 ②/③. **New / widened:** DV-19 (one walk, three rows); **DV-8 is common** (36 food delete
  tombstones stuck `pending`); no `health-alerts` channel (RV-155). Q-11 ran and filled nothing.
- **Phone:** gesture nav, APK 1.465.52. RV-205/206 gallery: private Artifact (URL on RV-205).
**Now:** nothing running; the phone is the owner's. I message him with 🔴 before the next sitting.

## Next

Owed: RV-206 P29–P31 (owner OK for font size, display size, battery saver) and P35–P38; RV-155 station
C (throwaway supplement writes) and the rest of B/D/E/F; BF-61's meal-list half; DV-18's still-frame
half; RV-150 cold start; BF-22 around an active workout. The admin console waits for DV-13.

## Rules for every message and every input

- **Lead every message with 🟢 (phone may be unplugged) or 🔴 (plug in / leave plugged).**
- **No raw `adb shell input` outside `rawTap`/`rawSwipe`/`rawSwipeThenTap`; `back()` refuses off-foreground.**
- **Wake key `keyevent 224` every 4 min; `am start` (never a tap) to front the app; `MSYS_NO_PATHCONV=1`.**
- **Watch prod `/api/version` every 30 s during a sweep; stop on any slowdown. Never open
  `/admin/oura-ble` until DV-13 closes; never `page.reload()`. Never press *Leave* on the workout dialog.**

**Standing permissions (owner, 2026-09-23):** writes, each undone straight after — food, supplement
tick, weigh-in (log today's own value), mood (overwrite allowed; restore it), activity confirm,
RV-45-style throwaway create/delete. **Only what a check needs.** Tooling upgrades: yes.

## Decided — do not re-litigate

- **`e2e/**` does not run on the phone**; Playwright is this role's driver (`pw.js`).
- **`/api/workout-sessions/day`'s `sessionId` is the PROGRAM session**, not a workout id.
- **A request count lies for local-first screens** — read the visible number too.
- **`/api/nutrition/food-logs` returns a bare ARRAY**; **block SW fetches with `Network.setBlockedURLs`**.
- **After any food delete, re-read the local row** (DV-15 fixed; DV-8 leaves some `pending`).
- **With gesture nav on, start raw swipes at x ≥ 100** — under ~24 px is Android's back gesture.
- **Captures never leave this machine as images** — the repo is public.

**Claimed paths:** `scripts/device/**` — mine for good (the role owns the harness).
