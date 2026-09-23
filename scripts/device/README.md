# Driving the S25 over USB

The e2e harness drives the **web** build. `playwright.config.ts` says so itself: *"`getLocalStore`
returns null, so every offline-first domain takes its web fallback here… A green run is evidence
about the web path only."* This directory removes that ceiling by driving the **real app on the
real phone** over the DevTools protocol.

**First run against the S25: 2026-09-23**, by the local Device Verification Agent (`📱 Device
Verification Agent 🟢`, baton `docs/agents/state/device-verification.md`). The connection worked
unchanged; what the protocol-only draft got wrong is recorded under **What the first run
corrected**, at the bottom — read that before trusting anything above it.

## What it unlocks, and what it does not

Three classes of check are unreachable from any sandbox and reachable here:

| | why the sandbox cannot |
|---|---|
| **Offline-first reads** | `getLocalStore` returns null off the APK; the device branch never runs |
| **Safe-area clearance** | `env(safe-area-inset-bottom)` is `0` in desktop Chromium, so the floored-utility rule cannot be checked at all |
| **What is actually painted** | the Samsung WebView compositor is where the SVG/gradient faults live |

And one more, which is the reason `back-gesture-sitting` exists: **the Android system back**.
Playwright cannot fire it because it arrives over a Capacitor channel, not as a DOM event.
`adb shell input keyevent 4` is the real thing, and `systemBack()` wraps it.

**It does not reach:** anything needing you physically present, and every *"does this feel instant"*
judgement. Those stay the owner's.

**The ring and the scale are NOT on that list, and an earlier draft of this file wrongly put them
there.** This drives the app on *the phone they are paired to*, so every app-side BLE surface is
reachable: what the pipeline has actually ingested, what the admin consoles read, whether a sync
button does anything, what a live HR subscription yields. That is most of the `devices` group and
all of `admin-console-sitting`. **What cannot be done is making the hardware DO something** — wear
the ring overnight, wake a radio that is power-gating (it sleeps when worn-idle by design), or
stand on the scale. The limit is on producing data, not on reading it.

## Setup, once

1. On the phone: Settings → About phone → tap Build number seven times → Developer options →
   **USB debugging** on.
2. Plug it in over USB and accept the prompt on the phone. `adb devices` must list it as `device`,
   not `unauthorized`.
3. Open the app and bring it to the foreground — the DevTools socket does not exist until the
   WebView does.
4. **Gesture navigation must be on** for any safe-area check to mean anything — and read the mode
   from Android, never from the inset: `adb shell settings get secure navigation_mode` (`0`
   three-button · `1` two-button · `2` gesture). `probe.js` prints it. On the S25 three-button nav
   gives a **48px** inset (the button bar), not `0`, so the inset alone cannot tell you. Changing the
   mode is a system setting: ask the owner, do not flip it yourself.

Node **≥ 22.12**: the harness itself runs on any Node 22, but `pnpm test` does not start below 22.12
(`rolldown`'s Windows binding is skipped at install — DV-1).

The APK must be the **debug** build. `MainActivity.java` gates `setWebContentsDebuggingEnabled` on
the manifest's own debuggable flag, so a release APK can never expose the socket. CI publishes
`assembleDebug`, so the rolling `apk-latest` release is already right.

## Running it

```
node scripts/device/probe.js                         # read-only: platform, real insets, a screenshot
node scripts/device/record.js 1500 --tap '#open'     # frames over time, with the ms each one landed
node scripts/device/tour.js [routes.json]            # walk a set of screens, capture each
node scripts/device/sweep.js [routes.json]           # P4: clearance, overflow, <44px, truncate+flex, nesting
node scripts/device/census.js [--rounds 2 --dwell 25 --idle-min 30]   # P2 + P7 + P10 in one walk
node scripts/device/perf.js coldstart|tti|cycles|longtasks|backstack   # Part B, P11–P16
node scripts/device/selftest.js                      # the harness against a local fixture — no phone
```

**Two drivers.** `cdp.js` is the dependency-free original. `pw.js` is Playwright's
`connectOverCDP` on the same socket (it attaches — see *What the first run corrected*) and is what
the probes are built on: `attach()` returns a device with `state()`, `tap()`, `tab()`, `back()`,
`go()`, `recordNetwork()`, `recordConsole()`, `watchAfter()`, `offline()`, `metrics()`,
`instrumentTimersAndReload()`, `localQuery()` and `shot()`. Its `tap` keeps both of `cdp.js`'s
paid-for rules — hit-test before touching — and drops the centring, so a scroll check is not
measuring an offset the harness chose.

**Probe → tool** (`docs/device-agent-probe-checklist.md`):

| probe | tool |
|---|---|
| P1 invalidation | `watchAfter(write, surfaces, { thenTab })` — the write is driven by hand in the sitting |
| P2 fetch-once, P7 console, P10 long session | `census.js` |
| P3 local store | `localQuery()` — SELECT/PRAGMA only; this is the owner's real store |
| P4 computed styles | `sweep.js` |
| P5 transition frames | `record.js --tap` |
| P6 repeat-visit paint | `record.js` from a tab tap, first frame with content |
| P8 offline | `offline(true)` — page network only; the native BLE ingest is not affected |
| P9 route census | `tour.js` plus tapping, never typed URLs |
| P11 cold start + TTI | `perf.js coldstart`, `perf.js tti` |
| P12 first-mount distribution | `perf.js cycles --n 10` — the full list, never a mean |
| P13 waterfall | every `measureVisit` carries `waterfall()`: counts, KB, duplicates, chain depth |
| P14 long tasks | `perf.js longtasks` — long tasks plus long-animation-frame script attribution |
| P15 path structure | `perf.js backstack` (guarded back; stops at Home) |
| P16 long session | `perf.js tti --label open|walk|idle` around `census.js --idle-min 30` |

`selftest.js` proves the driver's own logic in a desktop Chrome through the same `connectOverCDP`
path (22 checks as of 2026-09-23, including `perf.js`'s timing, chain depth and long tasks). It proves
nothing about the WebView — the Android back, the local SQLite and the real inset are only settled on
the phone. `sweep.js` and `census.js` have run on the S25; `perf.js` has **not** yet.

Run `probe.js` first; if it cannot connect, nothing else here will either. It changes nothing.
`ADB_PATH` and `DEVICE_CDP_PORT` override the `adb` binary and the forwarded port;
`DEVICE_PROBE_OUT` moves the output directory.

### Why there is a recorder as well as a screenshot

`chrome://inspect`'s mirrored phone screen is `Page.startScreencast` (the compositor's own frames)
plus `Input.dispatchTouchEvent` (taps sent back) — the same protocol this harness speaks. The mirror
exists so a **human** can watch and click; for deciding whether something is *right*, reading the
DOM beats looking at a picture of it.

What the mirror has that a screenshot does not is **time**, and three owed checks are timing
questions no still frame can answer:

| | the question |
|---|---|
| **RV-74** | the hero's number eases over 600 ms while the ring snaps — do they end together? |
| **RV-75** | is the sheet 300 ms, or the stock 500? `duration-250` was written for the close and **is not a Tailwind class**, so it compiled to nothing. A typo'd class fails nothing; only a measurement finds it |
| **RV-72** | do the bars animate a compositor property, or a layout one? |

`record.js` writes each frame named with its offset from the start, plus an `index.json`. **The
timestamps are the evidence; the frame count is not** — the phone drops frames under load, and it
prints the longest gap so a sparse recording is never mistaken for a fast transition.

### How a session that is not on this machine reviews the app

It cannot see the phone, and asking a person to screenshot every screen does not scale past a
handful. The channel is **git — as text, never as images.**

> ⛔ **This repository is public** (Q-49). Every capture is the owner's real production account:
> name, email, avatar, health numbers. An earlier draft of this file said to push the capture folder
> to a `device-captures/*` branch — **that publishes it**, and deleting the branch afterwards does
> not un-publish it. `device-probe/` is gitignored for this reason. Never `git add -f` it.

So the local agent reads the captures here and writes what they show — the route, what was on
screen, the numbers — into the backlog entry, the journal entry or its baton. The `tour.json`
digest is text, but it can still carry names and values from the screen: read it before quoting
any of it into a commit.

**Each screen yields more than a picture.** `tour.json` carries a per-screen digest taken *in the
page*: the real route, what the tab bar thinks is active, visible error text, the button count,
whether the page scrolls horizontally, and the computed bottom padding of the lowest action row
against the measured safe-area inset. Most *"is this feature working"* questions are answerable
from the digest alone; the image is for the half that is genuinely visual. That matters for a
remote reviewer, who pays for every image and reads text for free.

A `~` in the output means the app did not end up where it was sent. That is often correct — a
guard, a redirect — and always worth reading before treating the capture as that screen.

### ⛔ Never read the route from an inspector's address bar

DevTools updates its URL bar on `Page.frameNavigated`. This app's tab flips are
`history.replaceState`, which fires no such event — so on a Capacitor WebView doing client-side
routing **the address bar goes stale and stays stale**, holding whatever it had when DevTools
attached.

This is not hypothetical: on 2026-09-22 a screencast showing `/more` above a rendered Home screen
was filed as a probable LA-109 recurrence — that entry's symptom word for word — and retracted
hours later when the owner reported the bar never updates for them at all. **A shipped fix was
nearly recorded as failing on device on the strength of a stale widget.**

`probe.js` evaluates `location.pathname` **in the page**, and every check here must do the same.

### Watching it yourself at the same time

Leaving `chrome://inspect` open while the harness is attached is worth trying — modern Chrome
supports several protocol clients on one target — but **screencast in particular may conflict**,
and this has not been tested. If the mirror goes black or the recorder returns no frames, that is
the collision; close one of them.

## Writing a check

`connect()` returns a `session` with `evaluate`, `screenshot` and `tap`; `systemBack()` is a
separate export because it is an `adb` call, not a protocol one.

```js
const { connect, systemBack } = require('./cdp');
const { session } = await connect();
await session.tap('[data-testid="log-food"]');
await systemBack();
const path = await session.evaluate('location.pathname');
```

**`tap` enforces two conditions, and they were expensive.** BF-165 spent three rounds of confident
wrong conclusions because a raw coordinate tap has no actionability check: on a 412×915 viewport two
controls sat below the fold, their taps hit nothing, and *"both failures share the `/activity`
prefix"* looked like a real differential when it was a coordinate artifact. So `tap` scrolls the
element into view and asserts `elementFromPoint` actually lands on it before dispatching, and
throws with the reason when it does not. **Do not add a coordinate tap that skips this.**

## Judging a result

A check that passes here is evidence about **one screen, one orientation, one navigation mode, on
one phone**. That is far more than the web harness can say and still less than a sweep. Record what
you were on when you read it — `probe.js` prints the path for that reason.

**What is automatable is not the same as what is owed.** These are behavioural checks: did the row
disappear, did back land on Home, is the computed padding above the gesture bar. A large share of
the device checks in the backlog are look-and-feel, and an automated pass is the weakest evidence
for exactly those. Expect this to clear the unambiguous ones and leave a shorter, harder list.

## What the first run corrected — S25 Ultra, 2026-09-23

Samsung SM-S938B, Android 16, WebView Chrome 152, APK 1.460.4 (debug), web v1.465.4, portrait,
three-button navigation. Each line is observed, not reasoned.

| the draft said | what the device did |
|---|---|
| `probe.js` will probably fail to connect | **Connected first time**, no change needed |
| a WebView often has no browser `webSocketDebuggerUrl` on `/json/version` | **It has one** (`ws://127.0.0.1:9222/devtools/browser`) |
| try `connectOverCDP` | **It attaches** — 98 ms, 1 context, 1 page, `location.pathname` readable. See below |
| `playwright-core` is a dependency | Only **transitively**, through `@playwright/test`. Resolve it with `require.resolve('playwright-core', { paths: [require.resolve('@playwright/test')] })` |
| three-button nav makes the inset read `0` | It reads **48px** (the button bar). Read `navigation_mode`; `probe.js` now does |
| push captures to a `device-captures/*` branch | **Never** — the repo is public. See the ⛔ above |
| (not stated) | A force-stop gives the app a new pid and a new socket name; `connect()` re-finds it with no change |

**`connectOverCDP` attaching means the `e2e/**` specs can in principle run against the real APK**,
which is the largest lever this directory has. **Do not just point `playwright.config.ts` at it.**
The phone is signed into the owner's **production** account, and those specs were written for the
seeded local `test@local.dev` — every spec that writes (logs food, completes a workout, edits a
program) would write into real health history. A device project needs a read-only allowlist of
specs, or a separate test account on the phone. That is an owner decision, not a config change.

**Two harness traps found on the first sitting, both mine to have avoided:**

- **`tap()` centres its target before tapping, which pins a scroll offset.** A scroll-restoration
  check that taps a row with `tap()` always leaves from the offset that centres that row, so "it
  came back to the same place" is true by construction and proves nothing. Centre, then shift the
  scroller by a known amount, and tap with a hit-tested touch that does *not* re-scroll — that is how
  BF-100 was measured (675→675, 1075→1075).
- **`adb()` returns stdout as a string, not `{ stdout }`.** Reading `.stdout` off it gives
  `undefined`, and a focus check built on that reported the app as backgrounded while it was on
  screen — one near-false finding before it was caught. Test the helper against a known state
  before trusting a negative from it.

**What a back press on this app looks like from `dumpsys`:** back from Home leaves
`mCurrentFocus` on `com.sec.android.app.launcher`, and relaunching prints *"its current task has
been brought to the front"* with the same pid and the same `performance.timeOrigin` — that is
"minimised", as opposed to finished and reloaded.

## What the first probe sitting taught — S25, 2026-09-23

`pw.js`, `sweep.js` and `census.js` all worked on the phone on first contact. What needed changing
was the reading, not the connection:

- **The first `Page.captureScreenshot` after attaching can time out** (20 s); the retry succeeded.
  Retry once before believing it.
- **`go()` stacks history.** Four back presses from `/program` after a sweep landed on `/cardio`, not
  Home. `home()` now returns through the router and waits for the tab bar.
- **A swipe tray is still animating ~0.9 s after an adb swipe** — `tap()` refused Delete because an
  svg of the row was still over it. That refusal is correct and is *not* evidence about BF-61; the
  immediate-tap question needs a raw `adb shell input tap`.
- **`recordNetwork({ bodies: /re/ })`** keeps response bodies. It is how BF-177's failure was told
  apart from a stale server: the post-push response carried the right number and the card ignored it.
- **Local-first writes make a request count lie.** Nutrition repaints from SQLite with no request, so
  P1 reads the visible numbers too — in hidden tab panels as well, which the shell keeps mounted.
- **`sweep.js` measures the touch box**, not the ink: `.tap-target-44` / `.tap-target-dot` add an
  invisible `::before`. And clearance compares with a 0.5 px tolerance — the tab bar's 56 device px
  ÷ 3.75 is 14.93, which an exact compare called short of a 15 px inset.
- **`census.js` records metrics per round.** Round 1 mounts every tab, so only growth after it is a
  leak signal.
- **`offline(true)` is page-level.** Fetches fail and `navigator.onLine` is false, but no offline
  banner appeared — the app may read Capacitor's network plugin, which this does not reach — and a
  force-stop drops it, so "survives a restart offline" needs real airplane mode.

### Sitting 2 — S25, 2026-09-23

- **The first screenshot after attaching timed out again** — twice now, both first attempts. Retry.
- **The phone sleeps after 5 minutes unless a key arrives**, and "Stay awake" is the owner's system
  setting. For an idle measurement, send `adb shell input keyevent 224` (KEYCODE_WAKEUP) every few
  minutes: it keeps the screen on without touching the app. The first sitting's disconnect was
  probably this.
- **A swipe tray is `aria-hidden` while closed** — any "visible" filter drops its Delete button.
- **A tray left open stays open across steps.** Check the row's `translateX` is 0 before a
  swipe-to-delete test, or you are testing an open tray.
- **⛔ Raw `adb input` is blind, and it has already cost the owner.** During the BF-61 tray
  experiments the app left the tab under test (`/health/activity`, then `/`), the hidden panel kept
  answering DOM reads so the scripts carried on, and later taps landed **outside the app — they
  opened another app (Tasks) and closed this one** on the owner's phone. **Raw input now goes only
  through `dev.rawTap()` / `dev.rawSwipe()`**, which refuse unless the app holds the foreground and
  is on `expectPath`, checked immediately before sending. Never call `adb shell input tap|swipe`
  directly. (`systemBack()` — keyevent 4 — stays, because back is the thing under test; check the
  path after it.)
- **After a cold reload `nav a[href="/"]` matched two elements** and Playwright's strict mode threw.
  Tab-bar locators are now scoped `.filter({ visible: true }).first()`. Whether the shell really mounts
  two tab bars after a reload was not checked.
