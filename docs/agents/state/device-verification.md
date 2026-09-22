# 📱 Device Verification — baton

> **Successor sessions are titled `📱 Device Verification Agent 🟢`** — exactly, emoji included —
> and are opened **locally** by the owner in the desktop app on the machine the S25 is plugged into.
> `create_session` makes a cloud session, which cannot reach the phone.

**Updated:** 2026-09-23 · **By:** the first-run session (`device/first-run`) · **Next ID:** `DV-2`
(`grep -rhoE '\bDV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## For the Orchestrator — read this part

- **I take every device check you scope.** Put a sitting in a `Batch:` and it is mine to run; tell
  the owner only what needs a human (wearing, weighing, feel, a system setting, a production write).
- **Device checks owed after this sitting: 100** (`next-item.js --sittings`), down from 104.
- **The phone is on THREE-BUTTON navigation.** Every safe-area/clearance check is invalid until the
  owner switches it to gesture nav — that is the one owner action unblocking the largest group.

## Now

**`back-gesture-sitting` + BF-111 ran on 2026-09-23** (web v1.465.4 · APK 1.460.4 · portrait ·
three-button nav · `keyevent 4`). PR on `device/first-run` (it carries OR-127's harness from #1411
merged with `main`; if #1411 lands first this rebases cleanly).

| entry | outcome |
|---|---|
| LA-109 | ✅ VERIFIED — back from `/more/details` → `/more`, More tab active. **Removed** |
| LB-107 | ✅ VERIFIED — back from all four tab roots → `/`; back from `/` minimises (same pid, same `timeOrigin`). **Removed** |
| BF-100 | ✅ VERIFIED — offset restored exactly (675→675, 1075→1075), system back and UI back, warm and after a force-stop. **Removed** |
| BF-166 | ✅ VERIFIED for tab-route, Home and sub-route sheets. **Stays** — `Keep:` narrowed to the mid-workout leave prompt |
| BF-165 | ❌ REPRODUCED — the sheet's `back()` eats the push **7 ms** after it on the S25. Stays READY, Lane B; sibling site `time-picker-sheet.tsx` recorded |
| BF-111 | ❌ the screenshot: numbers and tick right, **"built 23 Aug" wrong** (rolling release's `published_at`). Gate removed → Lane A |

## Next — in this order

1. **Offline-first reads** — binary, and never exercised anywhere (`getLocalStore` is null off the
   APK). Needs airplane mode → ask the owner to toggle it, or a CDP offline emulation held open for
   the whole check (untested: the harness opens one connection per script).
2. **`admin-console-sitting`** (7) and the **devices** group (10) — mostly "does this button do
   anything", reachable because this is the phone the ring and scale are paired to. Read-only
   buttons first; anything that re-keys, re-pairs or syncs → ask.
3. **`motion-polish`** via `record.js` (RV-74/75) — **`record.js` and `tour.js` have not run on
   the device yet**; expect to fix something.

## Blocked — on the owner

- **Gesture navigation on** — unblocks every safe-area check.
- **Node ≥ 22.12 on this machine** (it has 22.9) — `pnpm test` cannot start without it. With DV-1
  (Lane O: the rule scripts break on Windows paths), `pnpm ci:local` cannot pass here; CI is the gate
  until both land.
- **BF-166's mid-workout half** — needs a workout started on the production account.
- **The `e2e/**`-on-device decision** — `connectOverCDP` attaches, but the specs write into the
  production account. A read-only allowlist, or a test account on the phone?

## Claimed paths

`scripts/device/**` — mine for good (the role owns the harness).

## Do not re-litigate

- **`connectOverCDP` works** on this WebView; `/json/version` has a browser websocket URL.
- **Captures never leave this machine as images** — the repo is public. `device-probe/` is
  gitignored.
- **Two back presses to close `/program`'s New Program sheet is correct** — the first closes the
  keyboard the autofocused field raised.
- **A back check does not need gesture nav** — `keyevent 4` is the same `KEYCODE_BACK`.
