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

**A probe that reports "looks fine" is worthless here.** Every item below returns a **number, a
list, or an artifact**. That is the whole point: a Review sweep turns evidence into a backlog entry,
and "seemed OK" cannot be filed, cannot be argued with, and cannot be re-checked next month.

- Report the **measurement**, then your reading of it — in that order, so the number survives even if
  the reading is wrong.
- **A zero is a result.** "No requests fired" is the finding in P1, not a failed probe.
- **Say which probes you could not run and why.** A silent omission reads as a pass.
- Name the **build** (APK version, or the Railway deploy's `/api/version`) and whether the app was
  cold-started or resumed. Several of these differ between the two.
- Where a probe finds something, give the **smallest reproduction**: route, action, and the observed
  value. Not a narrative.

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

- **Bottom-anchored clearance.** For every `position: fixed` or `sticky` element whose bottom edge is
  within 24 px of the viewport bottom, report the **computed `padding-bottom` in px** and the
  element's selector. The floored utilities (`pb-safe-action`, `pb-safe-action-lg`) must resolve to a
  real number; bare `env(safe-area-inset-bottom)` resolves near **zero** on Android gesture-nav,
  which is the recurring bug. **Report the actual resolved px of `env(safe-area-inset-bottom)` on
  this device once** — everything else is read against it.
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
