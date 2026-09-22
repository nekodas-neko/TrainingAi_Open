# Driving the S25 over USB

The e2e harness drives the **web** build. `playwright.config.ts` says so itself: *"`getLocalStore`
returns null, so every offline-first domain takes its web fallback here… A green run is evidence
about the web path only."* This directory removes that ceiling by driving the **real app on the
real phone** over the DevTools protocol.

**It has never been run against a device.** No sandbox in this project has `adb` or a phone, so
every line was reasoned from the protocol rather than observed. The first run is the test — expect
to fix something and record what, rather than trusting a clean read.

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
4. **Gesture navigation must be on** for any safe-area check to mean anything. With three-button
   navigation the bottom inset reads `0` and a broken clearance looks fine.

The APK must be the **debug** build. `MainActivity.java` gates `setWebContentsDebuggingEnabled` on
the manifest's own debuggable flag, so a release APK can never expose the socket. CI publishes
`assembleDebug`, so the rolling `apk-latest` release is already right.

## Running it

```
node scripts/device/probe.js                         # read-only: platform, real insets, a screenshot
node scripts/device/record.js 1500 --tap '#open'     # frames over time, with the ms each one landed
node scripts/device/tour.js [routes.json]            # walk a set of screens, capture each
```

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
handful. The channel is **git**:

```
node scripts/device/tour.js
git checkout -b device-captures/$(date +%F) && git add device-probe && git commit -m "device tour" && git push
```

The reviewing session pulls that branch and reads the folder. **Delete the branch once it has been
read** — this puts images in git, which is why the captures are JPEG-width-capped and why the
branch is never merged to `main`.

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
