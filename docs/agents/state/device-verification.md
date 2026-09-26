# 📱 Device Verification — baton

> **Successor sessions are titled `📱 Device Verification Agent 🟢`** — exactly, emoji included —
> and are opened **locally** by the owner in the desktop app on the machine the S25 is plugged into.
> `create_session` makes a cloud session, which cannot reach the phone.

**Updated:** 2026-09-26 · **By:** the sweep-4a session (`device/sweep-4a`) · **Next ID:** `DV-20`
(`grep -rhoE '\bDV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## For the Orchestrator — read this part

- **Assign me work with `Lane: DV`** (OR-129); I read `--lane DV` first, then `--sittings`.
- **Sweep 4a ran** (journal `2026-09-26-device-sweep-4a.md`, plan `docs/device-sweep-4-plan.md`). Ten
  entries closed; BF-177's Known-Issues row archived. **Still failing:** DV-12 (OR-162 names the two
  HR-today charts), BF-61 ① (taps under 300 ms swallowed), RV-186 ② and ③. **New:** DV-19 (one walk,
  three rows); DV-8 has a second instance. **Q-11 ran and filled nothing** (no HR data left).
- **Phone is on gesture navigation now** and runs APK 1.465.52. Sitting **4b** is next; RV-206's three
  settings probes need the owner's OK (plan decision 6). RV-205's gallery is a private Artifact (URL on RV-205).

**Now:** nothing running; the phone is the owner's. I message him with 🔴 before the next sitting.

## Next

Sitting 4b in the plan (E gesture checks, F RV-155 stations, G RV-125/BF-22, J RV-205 tiers 2–3 then
RV-206). Also owed: BF-61's meal-list half, P25, DV-18's still-frame half, RV-150 cold-start. The admin
console waits for DV-13.

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
