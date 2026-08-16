# Home-screen speed check on the S25 — what to run, what to send back

**Why this exists.** Two speed fixes have shipped for the home screen (code-splitting its sheets,
prefetching the other tabs' code on idle) and **neither has ever been measured on the phone**. The
next step up in size is bundling the whole app shell into the APK, which is a large piece of work.
This checklist produces the number that says whether that is worth doing. Backlog **Q-51 Task 3**;
it gates **Q-1b**.

You need a laptop with Chrome and a USB cable. Budget 20 minutes.

---

## Setup — once

1. On the phone: **Settings → About phone → Software information → tap "Build number" seven times**
   to unlock Developer options.
2. **Settings → Developer options → USB debugging: on.**
3. Plug the phone into the laptop. Accept the "Allow USB debugging?" prompt on the phone.
4. On the laptop, open Chrome and go to **`chrome://inspect/#devices`**.
5. The phone should appear with `com.trainingai.app` under it. Click **inspect**. A DevTools window
   opens showing the app's WebView.

If nothing appears: unplug, re-plug, and re-accept the prompt. Occasionally the app has to be
foregrounded first.

---

## Measurement 1 — cold start (the important one)

> ⚠️ **The procedure that was here was not runnable, and the reason is worth keeping.** It said to
> start a Performance recording and *then* cold-start the app. **Killing the app destroys the
> WebView**, so the DevTools target disconnects; the relaunch is a *new* target you would have to
> re-attach to, by which time the cold start is over. No recording can span the kill.
>
> **Use [`docs/device-runsheet-2026-08-04.md`](device-runsheet-2026-08-04.md) Step 1** — three
> approaches that do work:
>
> 1. **A screen recording** for the wall-clock number, which is what the thresholds below are
>    actually expressed in.
> 2. **A Console read of `performance.getEntriesByType(...)` after a normal cold start.** The
>    browser keeps navigation and paint entries for the life of the page, so the numbers are still
>    there when you attach afterwards — **no race at all.** This is the most useful of the three and
>    needs no code and no recording.
> 3. **A DevTools *reload* profile** as a recordable proxy for the JS half: a reload re-fetches the
>    document and re-executes all the JavaScript — exactly what bundling the shell would change —
>    while skipping native startup, which bundling would not change anyway.
>
> Measurements 2 and 3 below, and the thresholds, are unaffected: both happen with the app already
> running, so the target never disconnects.

### What to send back

- **A screenshot of the whole Performance panel** for each run, with the screenshot filmstrip
  visible along the top.
- **The Summary donut** at the bottom (Scripting / Rendering / Painting / System / Idle).
- If it is easy: click the **⤓ (Save profile)** icon and send the `.json` file — that is worth more
  than any screenshot, because it can be re-read properly rather than eyeballed.

### The number that matters

From the filmstrip: **how long from tapping the icon to the first frame showing real content.**
Rough guide for what it means:

| Time to real content | Reading |
|---|---|
| under ~1.5s | already fine — bundling the shell is not worth it |
| ~1.5–3s | worth looking at where the time goes before deciding |
| over ~3s | something is genuinely slow; the profile will show whether it is JS or the network |

---

## Measurement 2 — switching tabs

1. With the app already open and the home screen settled, start a new **Performance** recording.
2. Tap **Health**, wait for it to paint, tap **Workout**, wait, tap back to **Home**.
3. Stop recording.

**Expected:** the first tap on each tab is slower than later ones; going *back* to a tab you have
already opened should be near-instant, because all five panels stay mounted and we just flip
visibility.

**If going back to an already-opened tab is NOT instant, say so.** That would be a genuine bug and
it changes what we work on next — it would mean the prefetch shipped in v1.251.2 is not doing its
job.

---

## Measurement 3 — thirty seconds, no touching

1. Open the app, land on home, start a **Performance** recording, and **do not touch the phone for
   30 seconds.**
2. Stop.

**Expected:** almost entirely idle after the first couple of seconds.

**If you see a repeating spike every second**, that is a timer re-rendering the screen when it
should not be, and it would be quietly draining battery. Worth catching.

---

## Optional but useful — the network view

While the app is running, DevTools → **Network** tab → reload the WebView (Ctrl-R in the DevTools
window).

Send a screenshot of the request list, sorted by **Size**. What is worth knowing: whether the app
is fetching the same thing twice, and how big the largest JavaScript file is.

---

## What I do with it

- Cold start under ~1.5s → **Q-1b (bundling the shell) gets dropped**, and the effort goes into
  whatever the profile actually shows as slow.
- Cold start slow **and** the profile blames JavaScript parse/execute → bundling probably helps, and
  the update-delivery question is already answered (GitHub Releases + the More → update button).
- Cold start slow **and** the profile blames the network → bundling is the wrong fix; the answer is
  caching or a smaller first payload.
- A repeating idle spike, or a slow return to an already-opened tab → those get fixed first,
  whatever the cold-start number says. Both are bugs rather than trade-offs.

---

## If you cannot get DevTools working

A plain screen recording of a cold start is still useful — start recording, swipe the app away, wait
five seconds, launch it, and stop once the home screen is fully painted. Frame counting gives a
rougher number, but it distinguishes "half a second" from "four seconds", which is the decision that
actually matters here.
