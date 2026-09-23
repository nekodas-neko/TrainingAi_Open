# 📱 Device Verification — baton

> **Successor sessions are titled `📱 Device Verification Agent 🟢`** — exactly, emoji included —
> and are opened **locally** by the owner in the desktop app on the machine the S25 is plugged into.
> `create_session` makes a cloud session, which cannot reach the phone.

**Updated:** 2026-09-23 · **By:** the sweep-2 session (`device/sweep-2b`) · **Next ID:** `DV-16`
(`grep -rhoE '\bDV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## For the Orchestrator — read this part

- **Assign me work with `Lane: DV`** (OR-129); I read `--lane DV` first, then `--sittings`.
- **Sweep 2 ran** (journal `2026-09-23-device-sweep-2.md`): 9 entries verified and removed, 5
  Known-Issues rows archived, ~30 entries annotated. **Top of the queue:** DV-14 (prod sat undeployed
  2 h, then caught up — cause unknown) and DV-13 (8-min outage while the admin console hung).
- **Still failing on the device after their fix deployed:** BF-177 (kcal left still waits for the
  next action), RV-103, RV-111, TN-53, RV-127. **New:** DV-15 (a deleted food resurrected as
  `synced`, Lane A). Phone was on **three-button nav** (RV-37 waits).

**Now:** nothing running; the phone is the owner's. I message him with 🔴 before the next sitting.

## Next

Not run in sweep 2 (carry into sweep 3): BF-95, BF-61's closed-tray variant, BF-161, BF-12, RV-125,
the RV-124 rows, Q-300, OR-118, Q-305, RV-128/129, RV-132, the RV-130 resume grid, TN-25, BF-147,
BF-22's listeners-per-visit measurement. Plus: DV-11's TalkBack listen and DV-6's look (owner), and
the admin console items (Q-316, BF-10, Q-544) **only after DV-13 is closed**.

## Rules for every message and every input

- **Lead every message with 🟢 (phone may be unplugged) or 🔴 (plug in / leave plugged).**
- **No raw `adb shell input` outside `rawTap`/`rawSwipe`; `back()` refuses off-foreground.**
- **Wake key `keyevent 224` every 4 min; `am start` (never a tap) to front the app; `MSYS_NO_PATHCONV=1`.**
- **Watch prod `/api/version` every 30 s during a sweep; stop on any slowdown. Never open
  `/admin/oura-ble` until DV-13 closes; never `page.reload()`.**

**Standing permissions (owner, 2026-09-23):** writes, each undone straight after — food, supplement tick, weigh-in (log today's own value),
  mood (overwrite allowed; restore it), activity confirm, RV-45-style throwaway create/delete.
  **Only what a check needs** — the other WRITE-ASK rows are declined. Tooling upgrades: yes.

## Decided — do not re-litigate

- **`e2e/**` does not run on the phone**; Playwright is this role's driver (`pw.js`).
- **`/api/workout-sessions/day`'s `sessionId` is the PROGRAM session**, not a workout id.
- **A request count lies for local-first screens** — read the visible number too.
- **`/api/nutrition/food-logs` returns a bare ARRAY** — `j.logs` reads 0 and passes any "gone" check.
- **Block SW-fetched requests with CDP `Network.setBlockedURLs`**, not `page.route`.
- **Captures never leave this machine as images** — the repo is public.

**Claimed paths:** `scripts/device/**` — mine for good (the role owns the harness).
