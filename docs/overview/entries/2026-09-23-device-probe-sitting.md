# 2026-09-23 — Probe sitting 1 on the S25: BF-177 fails on the device, and why the browser said it passed

**Branch:** `device/probe-sitting` · **Agent:** Device Verification · **Docs + `scripts/device/**`.**

First run of the Playwright-over-CDP tooling (#1424) against the phone, working Review's probe
checklist (`docs/device-agent-probe-checklist.md`, RV-124…RV-133). Web v1.465.4, APK 1.460.4,
portrait, **gesture navigation** (bottom inset 15 px), signed in as the owner, with his approval for
five write types, each undone straight after. The phone disconnected before the last steps.

## The finding that matters: BF-177 is FAILED on the S25

Logging a food from the Nutrition tab updates the diary and the ring, and **"kcal left" does not
move** — for 6 s sampled every second, and still a minute later — while the server already has the
right number. With response bodies captured the mechanism is plain: the hook's one-shot balance
refetch fires at the **local** write and reaches the server **~60 ms before the outbox push**, so it
gets the old figure; the correct post-push response arrives ~500 ms later on another subscriber's
request, and the card never takes it. The browser e2e is green because on the web path the write is
an awaited POST. That is the Canonical Runtime rule in one bug: *green on web, wrong on the device.*
BF-177 is back in Lane B's READY with the trace and a fix direction (subscribe the card to the key).

## The rest of the sitting

| probe | outcome |
|---|---|
| P4 layout sweep (RV-127) | Clean on clearance, `truncate`+flex, nesting. Spills looked at and benign. Three 21 px-tall inputs on `/more/details` left unjudged. Found **DV-4**: the Sleep card's Deep hours in `#1e3a70` ≈ 1–1.6:1 contrast |
| P7 console (RV-130) | 0 failed requests. **499+** *"Rendering was performed in a subtree hidden by content-visibility"* — layout forced inside hidden tabs, unattributed |
| P10 long session (RV-133) | Walk half flat by round 3 on heap, listeners, nodes, timers. Idle half not run |
| P3 local store (RV-126) | First read of the on-device SQLite. Tombstones present, food renders offline. Found **DV-5**: pushed rows left `pending` (33 food tombstones, one set) |
| P8 offline (RV-131) | Offline write on screen in 256 ms, queued, pushed 2.0 s after reconnect. No tab blank. No offline banner (probably not reachable by page emulation) |
| P1 invalidation (RV-124) | Food log and delete only → BF-177 |
| P2 fetch-once (RV-125) | Baseline without writes; not a verdict yet |
| BF-61 swipe-delete | Slow tap works; the immediate tap is still owed |
| P5/P6/P9 | Not run |

**DV-6** (owner-gated): scrolled content passes under the status bar's clock with nothing behind it.

## Harness, as used

Four fixes, all in `scripts/device/`, and each recorded in the README's new section: `home()` returns
through the router (four back presses after a sweep landed on `/cardio`); the sweep measures the
touch box, not the ink, and compares clearance with a 0.5 px tolerance; `census.js` records metrics
per round; `recordNetwork({ bodies })` keeps response bodies. `selftest.js` still 18/18.

## Production data

Five food writes over the sitting — log, delete, log, delete, offline log, delete — **all deleted**.
Afterwards the server returned **no Cocoa logs** for 2026-09-23 and intake back at **434 kcal**.

## Not exercised

The other four write types, every surface off the Nutrition tab except Home's card, the 30-minute idle,
the offline restart, frames (P5/P6), the route census, and light theme.
