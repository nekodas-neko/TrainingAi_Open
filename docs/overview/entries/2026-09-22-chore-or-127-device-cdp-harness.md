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

## Two corrections the owner made, and one standing change

**The ring and the scale are reachable, and saying otherwise was wrong.** Three places in the first
draft said the harness "does not reach the ring or the scale — real BLE needs real hardware". The
owner's point: *"then you get the exact app that has the devices connected."* Correct. This drives
the app on **the phone they are paired to**, so every app-side BLE surface is reachable — what the
pipeline has actually ingested, what the admin consoles read, whether a sync button does anything.
That is most of the `devices` group and all of `admin-console-sitting`, about 17 checks written off
by a sentence. **The real limit is on making the hardware PRODUCE** — wearing the ring overnight,
waking a radio that power-gates when worn-idle, standing on the scale. Reading is not producing,
and the first draft conflated them. Corrected in `probe.js`, the README and the entry.

**Structural questions are the agent's now** — owner, this session: *"I'd like it if you could take
a lot of these structural questions."* Written into CLAUDE.md as a standing narrowing of the
decisions section. Architecture, tooling, process, layout, naming, how to test something: decide,
state the call in one line, continue. What stays theirs is short — data destruction, money, auth
and secrets, scoring calibration, and genuine product preference. **A delegated call still gets
written down**, with its reason and its reversal cost: the trade is *being asked* for *being able
to read it later*, and the second half is what makes the first safe.

## The testing order, decided rather than asked

Acting on that rule immediately. **Not by group size — by how unambiguous the answer is.** A check
whose result is a number or a boolean is worth ten whose result is an opinion.

1. **Prove the pipe** (`probe.js`, once) — the only step needing the owner.
2. **Try `connectOverCDP` before writing any bespoke check.** If it attaches, the ~100 existing
   `e2e/**` specs run against the real device on a config change alone. That is a multiplier no
   hand-written check matches, and it is the highest-leverage unknown in the plan.
3. **Offline-first reads** — binary, mechanical, and never exercised anywhere.
4. **Safe-area clearance as one sweep**, not N checks: walk every bottom-anchored action row and
   assert computed padding ≥ the measured inset.
5. **Devices and the admin console** (17), reachable for the reason corrected above.
6. **`motion-polish` via `record.js`** — measurable rather than judged.
7. **Look-and-feel stays the owner's.** Automation is the weakest evidence for exactly those.

Writing this onto OR-127 rather than into `docs/superpowers/plans/` is itself a structural call: a
seven-line order of attack for tooling that already exists is not a plan document, and putting it
where the tool is described keeps it from going stale separately.

## A finding filed and retracted the same day

A DevTools screencast showed the address bar reading `/more` above a rendered Home screen — LA-109's
recorded symptom word for word, on a fix that shipped 2026-09-15 with its device check owed. It was
filed as an observation within minutes.

**The owner then reported that the bar never updates for them at all; it is stuck at whatever it
held when DevTools attached.** So it says nothing about the app's route, and the observation was
retracted the same day.

**The mechanism is worth more than the false alarm.** DevTools updates its address bar on
`Page.frameNavigated`. This app's tab flips are `history.replaceState`, which fires no such event —
so on a Capacitor WebView doing client-side routing the bar is *expected* to go stale, and is never
a reliable read. **A shipped fix was nearly recorded as failing on device on the strength of a
stale widget.** `probe.js` and `tour.js` both read `location.pathname` in the page, and the rule is
now in the runbook and the module map: never read the route from an inspector's address bar.

## How a remote session reviews the running app

The owner asked what, short of pasting screenshots by hand, would let a session review live pages.
Decided rather than asked, per the standing rule: **the channel is git.** `tour.js` walks a set of
screens and writes a folder; it is committed to a throwaway `device-captures/<date>` branch and
pushed; the reviewing session pulls and reads it, then the branch is deleted. It never merges —
this puts images in a repository, accepted only because it is bounded and auditable.

**The digest is the part that matters, not the image.** Each screen carries a DOM summary taken in
the page: the real route, the active tab, visible error text, the button count, whether the page
scrolls horizontally, and the lowest action row's computed bottom padding against the measured
safe-area inset. **A remote reviewer pays for every image and reads text for free**, and most
"is this working" questions fall out of the digest alone.

Rejected: hand-pasted screenshots (works, does not scale, and is what prompted the question), and a
live view (impossible — the reviewing session is a container with no path to a USB device).

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
