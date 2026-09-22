# 📱 Device Verification Agent — baton

> **Successor sessions are titled `📱 Device Verification Agent 🟢`** — exactly, emoji included.
> A renamed successor is a lost thread even with a perfect baton.

**Updated:** 2026-09-22 · **By:** the Orchestrator, seeding the role · **ID prefix:** `DV-`
(`grep -rhoE '\bDV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` finds your next number.)

## What you are

The only agent that can see the real app on the real phone. Every other session in this project runs
in a cloud container with no path to a USB device — which is why `playwright.config.ts` says its own
harness is *"evidence about the web path only"*.

**You verify and report. You do not implement product fixes.** Lane A owns the engine, Lane B the
surface. The one thing you own is `scripts/device/**`.

## Now — nothing has been run yet

**`scripts/device/**` has never executed against a device.** It was written from the protocol by a
session with no phone. Your first hour is making it work, and **what broke is the most valuable
thing you will produce that day**, because nobody in this project knows it.

## The task list

Tick a box only for something you **observed**. Three outcomes, never a fourth: **VERIFIED ON THE
S25**, **FAILED ON THE S25** (which is work now, not verification debt), or **COULD NOT CHECK**
with the reason. Write the outcome into the entry in `docs/implementation-backlog.md` as well —
this file is state, the entry is the record.

### Round 0 — make the tool work

- [ ] `node scripts/device/probe.js` connects. Record every fix it needed.
- [ ] **Try `chromium.connectOverCDP('http://127.0.0.1:9222')`** (playwright-core is already a
      dependency). **If it attaches, stop and say so loudly** — the ~100 existing `e2e/**` specs
      could then run against the real device on a config change, which is worth more than every
      bespoke check below combined. If it refuses (an Android WebView often exposes no browser
      target), that is a one-line finding and the bespoke path continues.
- [ ] `node scripts/device/tour.js` produces a folder, and its digest numbers look sane.

### Round 1 — the back-gesture sitting, all five in one pass

`adb shell input keyevent 4` is the real Android back; Playwright cannot fire it because it arrives
over a Capacitor channel. That is why these five are batched.

- [ ] **BF-165** — the owner's live report: *"when I try click the treadmill; or any 'Other
      activity' nothing actually happens"*, *"it just scrolls to the top of cardio hub"*. Root cause
      is measured: the sheet's own `history.back()` lands ~400 ms after the push and eats it. Does
      it still reproduce? And does it happen on **any other sheet that navigates** — the scope
      correction says the defect is *any navigation issued from inside a closing sheet*.
- [ ] **LA-109** — Home → More → Profile details → system back. Must arrive on **More**, More tab
      active. Home instead is the unfixed behaviour.
- [ ] **LB-107** — from Health/Workout/Nutrition/More, system back → **Home**, not the launcher and
      not a dead press. Then from Home, back again → the app minimises.
- [ ] **BF-100** — from a scrolled `/more`, open Profile details and return. Does the offset come
      back? If it lands at the top, this is buildable work again.
- [ ] **BF-166** — the back listener against the overlay stack; ships with the four above.

### Round 2 — three that are blocking, cheap, and unrelated to each other

- [ ] **BF-111** — open **More → About** and capture it. It shipped, then FAILED on the S25 with no
      note, and the whole difficulty is which-number-where: it shows the app version, the Android
      build version and an up-to-date tick. Say which of the three is wrong.
- [ ] **LB-116** — the offline check-in. Queue one with **no network** and confirm the stored
      `suggested_sore_muscles` is what the sheet drew at the time, not what the server derives when
      the mutation lands hours later.
- [ ] **Q-477** — the date rollover. It hangs off `visibilitychange`, which behaves differently in a
      WebView than a desktop tab; a real backgrounding across local midnight is the case that
      matters.

### Round 3 — then work by how unambiguous the answer is

`node scripts/next-item.js --sittings` lists all 104, grouped by screen. **Not by group size — by
how binary the result is.** A check that yields a number or a boolean is worth ten that yield an
opinion.

- [ ] **Offline-first reads** — binary, mechanical, and never exercised anywhere, because
      `getLocalStore` returns null off the APK. Highest value per check in the queue.
- [ ] **Safe-area clearance as ONE sweep**, not N checks: every bottom-anchored action row's
      computed bottom padding ≥ the measured inset. `tour.js`'s digest already computes it per
      screen, so this may be answerable from a tour alone.
- [ ] **Devices + `admin-console-sitting`** (10 + 7) — reachable because this is the phone the ring
      and scale are paired to. Mostly *"does this button do anything"*, which is binary.
- [ ] **`motion-polish` via `record.js`** — RV-74 (does the ring finish with the number, or 600 ms
      before it) and RV-75 (300 ms, or the stock 500 — `duration-250` is **not a Tailwind class**,
      so it compiled to nothing; a typo'd class fails no test and only a measurement finds it).

**Look-and-feel stays the owner's.** Automated evidence is weakest exactly there. Do not convert an
opinion into a pass.

## Do not re-litigate

- **Never uninstall the app.** It destroys the Oura ring's BLE key, which is **not** recoverable
  from this repo, the server, or any log. Read `docs/canonical-runtime-android.md` first.
- **Never re-onboard the official Oura app** to "fix" staleness — it can force a firmware update
  that breaks the reverse-engineered BLE protocol.
- **You can read what the hardware produced; you cannot make it produce.** Wearing the ring
  overnight, waking a radio that power-gates when worn-idle, standing on the scale — the owner's.
- **Gesture navigation must be on.** Three-button nav reports every safe-area inset as `0`, and a
  broken clearance looks perfectly correct.

## Gotchas worth carrying

- **⛔ Never read the route from an inspector's address bar.** DevTools refreshes it on
  `Page.frameNavigated`; this app's tab flips are `history.replaceState`, which fires no such event,
  so it goes stale and stays stale. That artifact produced a false LA-109 finding **and its
  retraction** on 2026-09-22 — a shipped fix was nearly recorded as failing on a stale widget.
  Read `location.pathname` in the page.
- **A tap must scroll into view and hit-test before dispatching.** BF-165 spent three rounds of
  confident wrong conclusions on a raw coordinate tap: two controls below the fold at 412×915 took
  taps that hit nothing, and *"both failures share the `/activity` prefix"* read as a real
  differential when it was a coordinate artifact.
- **Read timestamps, never frame counts.** The phone drops frames under load, so a sparse recording
  reads as a fast transition.
- **A result that does not name its screen, orientation and navigation mode is not a result.**
- **`pnpm ci:local` is the pre-push gate, run unpiped.** `check:rules` alone is not, and believing
  it was turned `main` red for every lane (#1247). Piping through `tail` reports the pipe's exit
  code and destroys the diagnostic.
- **Check for conflict markers before staging.** `git add -u` after a merge stages them; that
  happened on 2026-09-22 and reached a pushed branch.
- **Expect a stale base.** `main` takes a commit every few minutes against a ~7-minute CI run.
  `get_check_runs` returning `total_count: 0` minutes after a push is a stale base, not slow CI.
