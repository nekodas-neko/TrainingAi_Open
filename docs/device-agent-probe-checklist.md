# Device-agent probe checklist — what to instrument, and what to send back

**Who this is for.** The device-verification agent, which drives the S25 APK's WebView over
DevTools/CDP. It is **not** the owner's tap-list — that is
[`device-verification-queue.md`](device-verification-queue.md), grouped by screen because the cost
there is picking the phone up. Nor is it the human smoke run
([`device-smoke-checklist.md`](device-smoke-checklist.md)) or the Home speed check
([`device-perf-profiling-checklist.md`](device-perf-profiling-checklist.md)). This file asks for the
things **only instrumentation can answer**: counting requests, enumerating computed styles across
every element, capturing frames, reading the local store. A human cannot do these and a sandbox
session cannot reach them, which is why every Review sweep to date ends on the same sentence —
*nothing was rendered or reproduced*.

## The reporting contract — read this before running anything

**Your role's three outcomes still apply, unchanged:** every check ends VERIFIED ON THE S25, FAILED
ON THE S25, or COULD NOT CHECK and why (`docs/agents/README.md`). An earlier draft of this file said
"never a verdict", which contradicted that and was wrong — corrected here.

What this file adds is the other half: **the verdict must carry the measurement that produced it.**
A VERIFIED with no number behind it cannot be filed as an entry, argued with, or re-checked next
month, and a Review sweep has nothing to do with it.

- Report the **measurement**, then the verdict — in that order, so the number survives even if the
  reading is wrong.
- **A zero is a result.** "No requests fired" is the finding in P1, not a failed probe.
- **COULD NOT CHECK is a real answer and is never a silent omission.** Several probes below are
  blocked right now; say so rather than skipping them.
- Name the **build** (APK version and the Railway deploy's `/api/version`) and whether the app was
  cold-started or resumed. Several of these differ between the two.
- Where a probe finds something, give the **smallest reproduction**: route, action, observed value.

### Two limits that change what you can run here

- **The phone is signed into production.** Probes P1 and P3 are built on *writes* — logging a food,
  saving a weigh-in, completing a workout — and those are real rows in the owner's real data. **Get
  his go-ahead per write type before running them**, and prefer the reversible ones (log then delete
  a food) over the ones with no undo (completing a workout). Where he says no, the probe is COULD
  NOT CHECK, not a guess.
- **The phone was on three-button navigation at the first sitting** (baton, 2026-09-23). Every
  clearance measurement in P4 is invalid until it is switched to gesture nav, because that is the
  mode the floored-utility rule exists for. Confirm the current mode before running P4 and report
  which mode the numbers were taken in.

### What the harness already does — do not rebuild it

`scripts/device/` landed with the role (#1417) and covers part of this file already:

- `probe.js` — the real resolved `env(safe-area-inset-bottom)`, whether the local store is real,
  and a compositor screenshot. **That is P4's anchor measurement**; take it from here.
- `record.js` — compositor frames with landing times, `--tap` to cover a transition. **That is P5.**
- `tour.js` — walks routes, captures each, and emits a DOM digest including the computed bottom
  padding of the lowest action row against the real inset. **That covers P9 and part of P4.**

So the genuinely new asks below are **P1, P2, P3, P7, P8 and P10** — the ones needing the network
layer, the local store's contents, or a long session. Extend the harness rather than working by
hand; `scripts/device/**` is the one code path the role owns.

---

## P1. Invalidation reachability — does a write actually repaint the surfaces that show it?

**Why this is first.** Missed invalidation is this project's single most repeated bug class (12+
incidents), and the sweeps keep finding it by *reading* code, which cannot tell a key that is
evicted-but-never-refetched from one that works. CDP can decide it mechanically.

**Method.** Enable Network. Perform the write. Count requests whose URL matches the surface's
endpoint, in the 3 s after the write, **without navigating**. Then switch tabs and back, and count
again.

**The reading:** zero requests before the tab switch and ≥1 after is the Q-402 shape — the key was
evicted correctly and the component that reads it never re-ran. That is a confirmed defect, not an
ambiguity.

Run the matrix. For each row: write, count, then repeat with the app **offline** (P8's switch).

| Write | Surfaces to watch |
|---|---|
| Log a food | Nutrition macro ring · Nutrition weekly calorie chart · Home nutrition card · Home day timeline |
| Delete a food | the same four |
| Save a weigh-in | Health Body cards · Home weight sparkline · readiness inputs |
| Edit macro targets | Nutrition banding · Home nutrition card |
| Confirm a detected activity from Home | Health Activity History · Home day timeline |
| Complete a workout | Home recommendation · next-session card · weekly stats |
| A ring sync completing | Home HR strip · Health HR card |

**Settles:** RV-103, RV-104, RV-106, RV-107, RV-109 — and tells RV-105 which shapes matter.

---

## P2. The fetch-once census — which effects never re-run inside the persistent shell

**The open question.** `scripts/check-fetch-once-effects.js` freezes 36 sites and calls 19 of them
"permanently mounted and can bite". That split was reasoned, not observed. It also cannot see
`useEffect(…, [userId])` — a dep array that never changes inside a shell that never unmounts — which
is how four of sweep 53's findings got past it.

**Method.** Instrument `window.fetch` at app start to record `(url, timestamp, stack)`. Then drive a
fixed 5-minute walk: Home → Nutrition → Health → Workout → More, twice round, with one write on each
tab. Dump the table.

**Send back:** for each `/api/*` endpoint, **how many times it was requested** and whether the count
rose after the tab it belongs to was revisited. An endpoint fetched exactly once in the whole walk,
on a tab visited four times, is a confirmed never-re-runs site — name the component.

**Settles:** the real membership of RV-105's 19, and likely new entries.

---

## P3. The local-store write path — the branch that only exists on the APK

`getLocalStore` returns null in the web sandbox, so **every local-first write path is untested by
construction** in `pnpm dev`. This is the single largest blind spot in the project.

- Save a weigh-in. Report **which cache keys were evicted** (read the eviction log or diff the cache
  table before/after) and whether `invalidateBiometrics` fired from the `pushMutations` → `pullDelta`
  round trip on the device that wrote it. **RV-108 turns entirely on this.**
- For each offline-first domain — food, supplements, activity, mood, body metrics, injuries — write a
  row, then read the local table directly. Report whether the row holds **everything needed to render
  it offline**, or only a foreign key. (The food-disappearing bug was a `food_item_id` with no name
  or macros.)
- Delete something in each of those domains and report whether the local row is **tombstoned or hard
  deleted**. A hard delete is invisible to other devices.

**Settles:** RV-108; audits the offline-first checklist's items 2 and 3 for real.

---

## P4. Computed-style sweep at the real viewport

A human eyeballs one screen; you can enumerate every element on every route.

- **Bottom-anchored clearance — gesture nav only.** Take the device's resolved
  `env(safe-area-inset-bottom)` from `probe.js` first; everything else is read against it. Then, for
  every `position: fixed` or `sticky` element whose bottom edge is within 24 px of the viewport
  bottom, report the **computed `padding-bottom` in px** and the element's selector. The floored
  utilities (`pb-safe-action`, `pb-safe-action-lg`) must resolve to a real number; bare
  `env(safe-area-inset-bottom)` resolves near **zero** on gesture-nav, which is the recurring bug.
  **On three-button nav this measurement proves nothing** — the inset is generous there and a
  broken utility passes. Report the nav mode with the numbers, or COULD NOT CHECK.
- **Horizontal overflow.** On every route, report any element where `scrollWidth > clientWidth` at
  384 px, with its selector and the overflow in px.
- **Tap targets.** List every interactive element whose rendered box is under 44 × 44 px, by route.
- **Truncation that cannot fire.** List elements carrying `truncate` whose computed `display` is
  `flex` — the class does nothing there. (RV-92 is one of these; report whether there are others that
  the source grep missed because the class is applied conditionally.)
- **Nested interactives.** Any `button` or `a` containing another `button` or `a`.

---

## P5. Transition frames — the questions RV-113/114/115 turn on

Screencast at the highest frame rate CDP will give you, through each transition, and report **frames
where nothing is visible**.

- **Tab switch.** The outgoing panel is hidden in the same commit the incoming one starts
  transparent. Report whether any captured frame shows **neither** panel — and if so, how many
  frames and at what duration. Also report what `bg-page` resolves to during the switch: if it is
  transparent, the blink shows the wallpaper, which is a different severity from showing the page
  colour. **Both of these are RV-113's stated open questions.**
- **Pushed routes.** For the six routes with no transition, report the gap in ms between the old view
  leaving and the new one painting.
- **More → Profile ↔ Friends.** Report whether the incoming view inherits the outgoing view's scroll
  position (RV-115).
- Confirm `MotionConfig reducedMotion="user"` is actually in effect: toggle the OS reduce-motion
  setting and report whether the transitions change.

---

## P6. Repeat-visit paint — is the cache seed doing its job?

The rule is that a skeleton flash on a **repeat** visit is a bug. Measure it rather than judging it.

For each tab, warm (visited earlier this session): report **ms from navigation start to first frame
containing real content**, and whether a skeleton was painted at all in between. A skeleton on a warm
visit means the synchronous `readCacheSync` seed is missing or is in a `useState` initializer rather
than a `useEffect`.

Do the same for a **cold app open**, and report the same two numbers per tab. RV-39 claims the
`/more/devices` ring card flashes a skeleton warm — confirm or kill it.

---

## P7. Console and the resume telemetry

- Collect **every** console message across the full walk, grouped and counted. Send the list, not a
  summary — a warning that fires 400 times is a different finding from one that fires once.
- Report any request that returns non-2xx during a normal walk, with route and status. `cachedFetch`
  swallows `!res.ok` unless the caller passes `onError`, so these are invisible on screen by design.
- **Correlate with production.** `error_events` carries `bf110 resume dom-intact` rows by URL —
  **Home 22 · Nutrition 14 · Health 11 · More 7 · Workout 2**. Resume the app on each of those
  screens after backgrounding it for 30 s, 5 min, and 30 min, and report what the DOM looks like on
  return. The counts say Home is where this bites; nobody has ever watched it happen.

---

## P8. Offline — the mode the whole architecture is built for and nobody has instrumented

Use CDP's network override, not airplane mode, so you can flip it mid-action.

- Go offline. Write in each offline-first domain. Report whether the row renders **immediately**, and
  whether it survives a **force-stop and reopen** while still offline.
- Still offline, walk every tab and report which surfaces go **blank** versus showing stale data.
  Blank is worse than stale here and the repo says so — `cachedFetch` cannot revalidate offline, so
  anything that renders nothing without a fresh payload is a hole.
- Come back online. Report **how long** until each written row reconciles, and whether any row
  **flickers away and returns** (the outbox-versus-server-copy race in BF-47).
- Report whether the offline shell serves every route or only the ones visited that session.

---

## P9. Route census

Enumerate every route the app can reach **by tapping only** — no typed URLs — from a fresh install
and from a warm one. Report any route that exists in the build but is reachable from nothing.
RV-121 says `/collection` is one; confirm, and find the others. Also report any picker or menu label
that names a different metric from what the target screen shows.

---

## P10. The long session — what the shell accumulates

The tab shell never unmounts, so anything that registers and does not clean up accumulates for the
life of the app.

After the 5-minute walk in P2, report: JS heap size at start versus end, **listener count by type**,
and the number of live `setInterval`/`setTimeout` handles. Then leave the app open and untouched for
30 minutes and report the same three again. A count that only ever rises is the finding.

---

## What I do with what you send

Each probe's output becomes either a backlog entry with the measurement quoted in it, or a line in
the sweep write-up saying the thing was checked and is fine — which is worth having, because the
alternative is that the next sweep re-derives the same suspicion from the same source code. **Send
the numbers even when they are boring.** The boring ones are what let a later finding be attributed
to a change rather than to "it was probably always like that".

---

# Part B — performance, timing and structure (P11–P16)

**Added 2026-09-23, because Part A was almost all correctness.** P6 (warm paint) and P10
(accumulation) touch timing; nothing else did. These six are the measurement half, and they exist
because **Q-51 explicitly asks for them**: the owner's position is *"Its mostly fine; I'd still like
it to be faster if possible"*, and that entry's own conclusion is that *"measure before refactoring"
is now **more** binding, not less* — a large refactor is a poor trade against "mostly fine" unless a
number says where the cost is.

**The one measured number that exists** is Q-51's: `/workout` visited five times in one session,
**four at ~100 ms and one at 1086 ms, all warm.** A first-mount cost, not a general one. Everything
below is aimed at turning that single observation into a shape.

**`docs/device-perf-profiling-checklist.md` is the human version of some of this** — it asks for
DevTools screenshots and a saved profile. Do not re-run it by hand. It does record the mechanic that
makes P11 possible, and it is worth reading once:

> *"A Console read of `performance.getEntriesByType(...)` after a normal cold start. The browser
> keeps navigation and paint entries for the life of the page, so the numbers are still there when
> you attach afterwards — **no race at all.**"*

That is the answer to "you cannot record across an app kill", and it is why cold start is now
measurable from a harness that attaches *after* the fact.

## P11 — cold start and per-tab time-to-interactive

Cold-start the app normally, attach, then read `performance.getEntriesByType('navigation')` and
`('paint')`. Report **`domContentLoaded`, `loadEventEnd`, `first-paint`, `first-contentful-paint`**,
and `performance.now()` at the moment of the read. Then for each tab, warm and cold: **ms from the
tap to the first frame with real content** (P6's number, taken here per-route rather than per-visit).

No kill is needed for the reads themselves and no recording has to span anything.

## P12 — the first-mount outlier, characterised

**Q-51's number is one observation. Make it a distribution.** For each of the five tab routes and
the main pushed routes: visit it, leave, return — **ten times**, all warm — and report the full list
of mount durations, not a mean. The question is whether the first mount of a route is reliably
expensive and by how much, or whether 1086 ms was a one-off.

Report alongside each outlier: what was on the main thread during it (P14's long tasks) and what was
in flight (P13's requests). **An outlier with neither is a different finding from one with both.**

## P13 — the per-screen network waterfall

`scripts/device/pw.js` already instruments the Network domain. For each screen, from tap to settled:

- **request count**, and the count of those that are `/api/*`
- **total bytes**, and the largest single response
- **duplicate URLs** — the same endpoint requested more than once for one screen
- **serial chains** — requests that only start after an earlier one finishes, with the chain depth

**The chain depth is the finding to look for.** Three requests in parallel cost one round trip;
three in series cost three, and on a phone that is the difference between instant and not.

## P14 — main-thread long tasks

Record `PerformanceObserver` long-task entries (>50 ms) across: a cold start, one pass through every
tab, a tab switch in each direction, and a scroll of Home and Health. Report **count, total blocked
ms, and the longest single task per interaction.**

Prior finding to check against rather than rediscover: a device profile once attributed **21.3% of
main-thread time to `animationiteration`**, which is why the repo pauses animations — confirm that
is still true, and whether anything else now dominates.

## P15 — path structure

Not speed; shape. For every route reachable by tapping:

- **depth** — how many taps from app open, and whether the same screen is reachable by two paths of
  different length
- **redirects** — any navigation that lands somewhere and immediately moves again
- **wasted navigations** — a push that unmounts the tab shell and then restores the same tab
  (RV-110's 37 sites are the source; this measures what they cost rather than counting them)
- **back-stack depth after a normal session** — press back repeatedly from a deep screen and report
  how many presses reach Home, and whether any press lands somewhere the owner never visited

## P16 — does a long session get slower?

**BF-22 is an owner report with a mechanism already narrowed:** *"everything is loading very
slowly"*, then *"actually its running a lot better after a force restart"* — so the slowdown is
in-memory client state, not the server or the database (the server-distance theory was measured and
was wrong).

Take P11's per-tab time-to-interactive numbers **at app open, after the P2 walk, and after 30
minutes idle**. Report the three sets side by side. RV-133 measures heap and listener counts over the
same window; **this is the timing half of the same question**, and the two together decide whether
the accumulation RV-133 finds is inert or is what BF-22 is feeling.

# Part C — what sweeps 1–3 made possible (P17–P22)

Added 2026-09-24 after reading sweeps 1–3. Each probe below is **read-only** unless it says
otherwise, and each uses a CDP domain the harness can already reach through `pw.js`. The reporting
contract above still applies: VERIFIED / FAILED / COULD NOT CHECK, with screen, orientation and
navigation mode on every result.

## P17 — the timezone census (every screen, two clocks that disagree)

`Emulation.setTimezoneOverride('America/New_York')` with the **profile left on Brisbane**, then walk
every route and snapshot the visible text of each. Repeat with the override cleared. **Every clock
time, date label and "today"/"yesterday" word must be identical in both snapshots**: the app is
meant to render in the user's zone, never the device's. A difference is the `toLocale*String`
-without-`timeZone` class that CLAUDE.md names, found mechanically across the whole app rather than
one screen at a time. DV-7 ran this on the Sleep screen only. Report the diff, per route.
Second pass: a fixed-offset zone (`Etc/GMT±N`) whose local time is currently **00:00–02:00**, which
is where a device-day and a user-day disagree about the date itself.

## P18 — fault injection, one endpoint at a time

`Fetch.enable` with a pattern for **one** `GET /api/*` endpoint, answered with a 500 (then, a second
pass, never answered for 20 s). Visit every screen that reads it. For each card: does it show an
**error state**, keep a **stale value with no sign that it is stale**, or **vanish**? The last two are
the Q-499 rule (a self-fetching card needs an explicit failure state) and RV-103 found one by hand.
**Never fail a write** (`POST`/`PUT`/`PATCH`/`DELETE`, or `/api/sync/*`); this probe is about reads.
Report a table: endpoint × card × {error shown, stale shown silently, vanished, unaffected}.

## P19 — how long the phone runs old code after a deploy

The sweep-2 runbook says *"restart the app after a deploy before re-checking a fix"*, which means the
running WebView does **not** pick up a Railway deploy on its own. Measure it: after a merge deploys
(watch `/api/version` flip), read the version the **running bundle** reports, then check again after
(a) staying in the foreground 10 min, (b) background → resume, (c) a force-stop → cold start. Report
the time or step at which each reached the new build, and what the service worker's cache holds for
the old one. **This decides the lag for every `Verify: device` in the queue**, and it is also how long
the owner runs a fix's predecessor.

## P20 — accessibility tree and broken-image census

`Accessibility.getFullAXTree` on every route: **interactive nodes with no accessible name**, images
with no alt text, and `img` elements with `complete && naturalWidth === 0` (a broken image). DV-11
(switches with no name) and DV-18 (a broken admin image) were each found by eye on one screen; this
finds the rest in one pass. Report counts per route and each offender's role and nearest text.

## P21 — what a tab tap writes to localStorage

DV-12's profile puts `localStorage.setItem` at **1–15 ms on every tab tap**. The suspect is
`lib/sqlite/cache.ts:82`, which stores `JSON.stringify(entry)` of the **whole payload** synchronously
on every cache write, and every visit revalidates. Wrap `Storage.prototype.setItem` with
`Runtime.evaluate` so it logs **key, value length and duration**, then tap through each tab. Report
the keys written per tap, their sizes, and the total size of `localStorage` against its quota. A
quota near full turns this from a cost into a failure, because `setItem` throws when it is full.

## P22 — the app left open across local midnight

The "today's data served after midnight" class (session 52) has only ever been checked by reading
code. With the app in the foreground at **23:55 Brisbane**, record which today-keyed values change at
00:00 and which do not until a tab switch or a restart: Home's day, Nutrition's diary date, the
readiness card, the timeline. **Needs an overnight sitting the owner agrees to**, so it is the one
probe here that cannot run whenever the phone is plugged in.

---

# Part D — the design and feel pass (P23–P28)

**Added 2026-09-25 (Review sweep 62, owner request):** *"keep looking at reviewable actions for
UI/performance/design that can be tested through DV — get it to write up a report or screenshots so
you can work on them."* Parts A–C measure correctness and load. This part is for what a user
**sees and feels**, and it is the first part whose main output is pictures.

### How the pictures reach Review — and never the repo

The baton's rule *"captures never leave this machine as images"* exists because **the repo is
public**. It still holds for the repo. **A private Artifact on the owner's account is not the
repo**, and the owner has asked for screenshots, so for this part:

- Publish **one private Artifact per sitting**, titled `DV design capture — <date>`, with each
  capture uploaded as an asset.
- The page is a plain gallery. **Every image is labelled with its route, its state, orientation,
  navigation mode, build and whether it is scrolled.** An unlabelled image cannot be filed.
- Put the P24–P28 measurements on the same page as a table, or as a JSON text asset.
- **Record the Artifact URL in the entry that asked for it** (RV-205), in its result line. The URL
  is safe to commit, because only the owner can open it. **Never** commit an image, and never share
  the link.
- If the local session cannot publish an Artifact, the visual half is **COULD NOT CHECK**. Still
  run P24–P28, whose output is numbers.

Review reads the gallery (Artifact `read` with an asset `path` saves each image locally), writes the
critique, and files the fixes to Lane B. **Review does not edit product code;** the lane does.

### Start here — the order, the budget and the harness calls (added after review, same day)

Part D is more than one sitting. Run it in this order and stop wherever the sitting ends. A partial
gallery of the screens the owner uses daily is worth more than a complete one of admin pages.

**0. Prove the channel first: one image, then read it back.**
- Publish the Artifact with **one** labelled capture (Home, warm).
- Attach the image as a **published supporting file** (the Artifact tool's `files` map). Do not use
  the asset store, which needs a declared capability.
- Read it back with the Artifact tool's `read` and that file's `path`, and record the URL on RV-205.
- **If either step fails, the visual half is COULD NOT CHECK.** Say why, and go straight to the
  numeric probes. Do not capture a hundred images first and discover the channel is closed.

**1. Tier 1 — about the first hour.**
- **P23** warm, with gesture nav where it is on, for the five tab roots and pre-workout.
  **Not the active workout:** starting one is a write.
- **P24** on those screens' primary controls.
- **P26** on food search and Describe.

**2. Tier 2.**
- P23 for the remaining pushed routes, plus offline, plus the sheets reachable without a write.
- P25.
- P27.

**3. Tier 3.**
- P23 cold and error states.
- P28.
- Admin pages.

**Budget and naming.**
- **About 60 images a sitting.** Use JPEG at quality 80, or PNG at the phone's native width, to
  stay well inside the Artifact limits: 15 MB per file, 64 MB per version.
- **Name every file `<route>__<state>__<nav>__<scrollN>.jpg`** (for example
  `nutrition__offline__gesture__1.jpg`). The name is the label, so it survives even if the page
  around it does not.

**Harness calls that work on this phone** (`scripts/device/pw.js`):
- **P24 and P26 use `rawTap`, not a programmatic `focus()` or `dispatchTouchEvent`.** On Android a
  script focus does not raise the soft keyboard, so P26 would pass for the wrong reason. A real tap
  is also what P24 is meant to time.
- **P25 uses `rawSwipe`,** with a `requestAnimationFrame` delta logger injected before the swipe.
  `Input.synthesizeScrollGesture` is not used anywhere in the harness and is unproven on this
  WebView.
- **P24's timing comes from the screencast frame timestamps** (`cdp.js` already streams them).
  Time from the `rawTap` call to the first frame whose pixels differ.

**P27's reference.**
- The intended tokens are the `@theme` blocks in `app/globals.css` (45 `--color-*` tokens) and the
  variants in `components/ui/`.
- Report a value as drift only when it **does not resolve to one of those**. Otherwise the census
  lists every intended grey as a finding.

## P23 — the screen gallery

`tour.js` already walks the routes and captures each. **Extend it rather than hand-driving.** For
every tab root and every pushed route:

- **Full-length capture, not only the first viewport.** Scroll and stitch, or capture each
  viewport in turn. Most layout faults live below the fold.
- **States, where the harness can reach them without a write:**
  - warm (the normal visit);
  - cold (first paint after a restart, taken at about 300 ms, then settled);
  - offline (`Network.setBlockedURLs` on `/api/*`, as sweep 3 did);
  - one error state per card family, via P18's fault injection.
- **Every sheet and dialog reachable by a tap that writes nothing**, open.
- **Gesture navigation for at least Home, Workout, Nutrition and one sheet.** Three-button
  navigation hides the bottom-clearance faults (see Part A).

## P24 — tap-to-feedback latency

P5 measures transitions between screens. This measures **the tap itself**. For about 20 primary
controls (each tab, the start-workout button, log set, the supplement tick, a food row, sheet
open/close, each segmented control), use `Input.dispatchTouchEvent` plus the screencast and record
the time from the input to **the first frame that changes**.

- Report per control: ms to first visual change, and ms to settled.
- **Flag anything over 100 ms to first change.** That is the point where a tap stops feeling
  instant.
- A control that shows no pressed state at all before its result lands is a finding in its own
  right, whatever its latency.

## P25 — scroll smoothness on the long lists

Fling-scroll (`Input.synthesizeScrollGesture`, repeated) with a `Tracing` or `rAF`-delta capture on:
- the food diary on a full day;
- the exercise library;
- workout history;
- Health's trend charts;
- the timeline;
- the admin tables.

Report per list:
- the frame count, the p50 and p95 frame time, and the number of frames over 16.7 ms;
- the long tasks that overlapped the scroll, with their top function.

## P26 — the soft keyboard

For every text input reachable without a write (food search, describe, weigh-in field, notes,
program editor, the feedback form), **focus it** and read `visualViewport.height` against:
- the input's rect;
- the rect of the primary button that submits it.

Report every case where either is covered by the keyboard or pushed off-screen, with a capture.
Sheets are the likely offenders.

## P27 — design-token census

For each route, collect from the computed styles of visible elements:
- the distinct **font sizes** and **font weights**;
- the distinct **text colours** and **background colours**;
- the distinct **border radii** and **shadows**;
- the distinct **gaps and padding values**.

Report, per route and app-wide:
- **the counts**, and the values used by fewer than three elements (the drift candidates);
- **text under 12 px**;
- **text/background contrast below 4.5:1** (3:1 at 18.66 px bold or 24 px and up), with the
  selector and the nearest text.

This is the numeric half of a design review: a page with nine greys and seven radii reads as
inconsistent before anyone can say why.

## P28 — motion inventory

On each route and during each transition, read `document.getAnimations()` and any running CSS
transitions. Report:
- property, duration, easing and the target selector;
- **every animation of a layout property** (`height`, `width`, `top`, `left`, `margin`), because
  those re-layout every frame where `transform`/`opacity` would not;
- the distinct durations and easings in use, app-wide. More than a handful means the motion has no
  system.

Confirm `reducedMotion="user"` is respected (P5 asks the same; one run answers both).
