# 📱 Device Verification — baton

> **Successor sessions are titled `📱 Device Verification Agent 🟢`** — exactly, emoji included —
> and are opened **locally** by the owner in the desktop app on the machine the S25 is plugged into.
> `create_session` makes a cloud session, which cannot reach the phone.

**Updated:** 2026-09-24 · **By:** the sweep-3 session (`device/sweep-3`) · **Next ID:** `DV-19`
(`grep -rhoE '\bDV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## For the Orchestrator — read this part

- **Assign me work with `Lane: DV`** (OR-129); I read `--lane DV` first, then `--sittings`.
- **Sweep 3 ran** (journal `2026-09-24-device-sweep-3.md`). Answered and closed: RV-128 (answer on
  RV-113), RV-129 (→ **DV-17**). Verified and removed: BF-95, BF-161, OR-118.
- **New for Lane B:** DV-16 (phantom "Leave workout?" after a finished workout), DV-17 (meal-plan
  skeleton on every visit), DV-18 (broken admin reference image). **DV-15 now 3 reproductions**,
  with a likely mechanism on the entry (Lane A). **BF-61's immediate tap fails.**
- **DV-12 has a lead** (chart.js label re-measure on every tap); **BF-22 is narrowed** (tab switching
  does not leak). Phone still on three-button nav.

**Now:** nothing running; the phone is the owner's. I message him with 🔴 before the next sitting.

## Next

Carry into sweep 4: RV-125 re-run with per-visit attribution; BF-22's counter around writes, sheets,
pushed routes and sync; BF-49's food row and Health's own timeline; BF-61's meal-list half; Q-300's
local-vs-server source. Plus: DV-6's look and DV-11's TalkBack (owner), and the admin console items
(Q-316, BF-10, Q-544, LB-5) **only after DV-13 is closed**.

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
- **After any food delete, re-read the local row** — DV-15 resurrects about one in three.
- **Captures never leave this machine as images** — the repo is public.

**Claimed paths:** `scripts/device/**` — mine for good (the role owns the harness).
