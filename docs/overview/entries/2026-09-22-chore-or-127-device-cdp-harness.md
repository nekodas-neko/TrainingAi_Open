# 2026-09-22 — `chore/or-127-device-cdp-harness` (OR-127)

**Orchestrator, owner-requested.** The owner asked whether they could plug the S25 into a computer
and have an agent drive it through devtools. The answer is yes, with one refinement, and the
harness for it ships here — **unrun**.

## The refinement

The owner's instinct was to point a browser-based session at the `chrome://inspect` page. That is
the right destination reached through the wrong door: `chrome://inspect` is a GUI over the DevTools
protocol, and a GUI is a poor control surface for an agent. `adb forward` plus the protocol itself
gives the same access with nothing in the way.

The session also has to be **local**. This one runs in an ephemeral cloud container; a phone on a
USB cable on the owner's desk is not reachable from it, and no amount of tooling changes that.

## It was already possible, and that was checked rather than assumed

`android/app/src/main/java/com/trainingai/app/MainActivity.java:519` calls
`setWebContentsDebuggingEnabled(true)`, gated on the manifest's own debuggable flag, and the APK is
built with `assembleDebug`. The installed app is inspectable now — nothing needs rebuilding, and
the rolling `apk-latest` release is already the right build.

## What it removes

`playwright.config.ts` states its own ceiling in its header: *"it drives the **web** build, where
`getLocalStore` returns null… A green run is evidence about the web path only."* Three classes of
check are unreachable from any sandbox as a consequence, and the backlog is full of all three:

| class | why no sandbox reaches it |
|---|---|
| offline-first reads | `getLocalStore` returns null off the APK; the device branch never runs |
| safe-area clearance | `env(safe-area-inset-bottom)` is `0` in desktop Chromium, so the floored-utility rule is uncheckable |
| what is actually painted | the Samsung WebView compositor is where the SVG/gradient faults live |

Plus the one `back-gesture-sitting` exists for: the **Android system back**, which Playwright
cannot fire because it arrives over a Capacitor channel. `adb shell input keyevent 4` is the real
thing, and `systemBack()` is a separate export precisely because it is an `adb` call rather than a
protocol one.

## What shipped

`scripts/device/cdp.js` — device discovery, socket discovery (the pid changes on every app start,
so it is found rather than assumed), the port forward, target selection, and a minimal CDP client
on Node 22's global `WebSocket`, so there is no dependency to install. `session.evaluate`,
`session.screenshot`, `session.tap`.

`scripts/device/probe.js` — the read-only first run. Reports whether Capacitor says this is really
native, what `env(safe-area-inset-*)` actually resolves to, and a screenshot from the compositor
itself. It changes nothing, and it prints the path it was taken on so a reading is never orphaned
from its screen.

`scripts/device/README.md` — the runbook, including the two setup conditions that silently
invalidate results: the APK must be the debug build, and **gesture navigation must be on** or every
inset reads `0` and a broken clearance looks correct.

## Decisions

**Raw CDP rather than `chromium.connectOverCDP`, and this is the first thing to revisit.**
connectOverCDP would be less code and would let the **existing `e2e/` specs run unchanged against
the device** — a far bigger prize than any bespoke check. It was not taken because it needs a
*browser* target and an Android WebView commonly exposes only page targets (`/json/version` with no
`webSocketDebuggerUrl`). From a sandbox that can test neither path, shipping a harness that might
not connect at all was the worse risk. Once a device confirms the forward works, try connectOverCDP
against the same port before writing a second bespoke check.

**`tap` enforces an actionability assert, and BF-165 paid for it.** It scrolls the element into
view and requires `elementFromPoint` to land on it before dispatching. That entry spent three
rounds of confident wrong conclusions because a raw coordinate tap has no such check: two controls
sat below the fold at 412×915, their taps hit nothing, and *"both failures share the `/activity`
prefix"* read as a real differential when it was a coordinate artifact.

## The screenshot was a gap, and the owner found it

The first draft captured a **single** frame. The owner clarified they meant `chrome://inspect`'s
mirrored phone screen — and that mirror is `Page.startScreencast` plus `Input.dispatchTouchEvent`,
the same protocol this harness already speaks. The `tap` half was built; the frames half was not.

The mirror exists so a human can watch and click, and for deciding whether something is *right*,
reading the DOM beats looking at a picture of it. **What the mirror has that a screenshot does not
is time** — and the entire `motion-polish` batch is timing questions no still frame can answer:

| | the question |
|---|---|
| **RV-74** | the hero's number eases over 600 ms while the ring snaps — do they end together? |
| **RV-75** | is the sheet 300 ms or the stock 500? `duration-250` was written for the close and **is not a Tailwind class**, so it compiled to nothing and left the stock value — a typo'd class fails nothing, and only a measurement finds it |
| **RV-72** | do the bars animate a compositor property, or a layout one? |

`record.js` writes each frame named by its offset from the start, plus an `index.json`, and takes
`--tap` so the tap lands *inside* the window rather than before it. It prints the longest gap
between frames, because **the phone drops frames under load and a sparse recording reads as a fast
transition**. The timestamps are the evidence; the frame count never is.

## Worth carrying

**The harness ships unrun, and says so everywhere it can be read.** No sandbox in this project has
`adb` or a phone, so every line was reasoned from the protocol rather than observed — including the
claim that it connects. OR-127 carries a `Keep:` naming that first run as the outstanding work, and
both source files carry the warning in their headers. This is the opposite of the usual failure
mode here, which is a fix documented from intent; the point is that "written carefully" is not
"observed working", and the distinction has to survive into the next session that reads it.

**Automatable is not the same as owed.** These are behavioural checks — did the row disappear, did
back land on Home, is the computed padding above the gesture bar. A large share of the 104 device
checks in the backlog are look-and-feel, where an automated pass is the weakest possible evidence.
The honest expectation is that this clears the unambiguous ones and leaves a shorter, harder list.

## Not done

- **Never run.** That is OR-127's `Keep:`.
- **No check suite** — one probe, not a sweep. What the second check should be is a question for
  after the first run, and it may be "point the e2e suite at it" rather than anything bespoke.
- **The device-verification gate is unchanged.** No Known-Issues row may cite this as a substitute;
  it narrows what the gate has to cover, it does not retire it.
