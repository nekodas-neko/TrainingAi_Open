# Device runsheet — 2026-08-04

One sitting. Everything currently owed on the phone, ordered so you never have to set the same
thing up twice.

**Roughly 30 min at the desk (steps 0–5).** The Railway console jobs (step 7) need no phone at all.

Tick as you go. Anything that behaves differently to what's written — say so; a surprise here is
worth more than a pass.

---

## Revised 2026-08-04 — three things came off this list without you doing them

You asked whether the answers could come from the admin endpoint instead of a manual pass. Three
could, and have. **Do not run these steps.**

**1. Step 1b — done.** You already sent the timings. Result and what it decides are in Step 1.

**2. Step 6's cadence question — answered from the database, and the answer is yes.** This step
existed because production had *zero* activities carrying a cadence value across all 42. That is no
longer true:

```
date        cadence_spm  cadence_source  duration_min  avg_hr
2026-08-01  120.1        strap           24            98
```

with a full `cadence_series` (`{"spm":118.3,"tSec":10}, {"spm":119.8,"tSec":20}, …`). **The strap
produces cadence and it persists to the saved activity.** That was the entire blocking question on
Q-47 — the 10-minute diagnostic walk is off the list.

**3. Step 4c's ultradian half — partly answered.** REM% for the last ten nights reads 18.4, 27.5,
27.3, 25.8, 22.0, 27.1, 15.6, 19.4, 18.8, 16.7 — median ≈ 22%, four of ten inside the 23–28% target
band. No redecode needed for that half. The **SpO₂ column** question still needs the device (it is
in the on-device epoch debug view, not on the server).

**One thing was added.** #1046 fixed a sync fault where *every* body-metric write was failing on the
phone — weight, steps, macros, water, resting HR, HRV. **Force-close and reopen the app after
installing**, so the fix is actually live before Step 5, because several of those checks write body
metrics and would otherwise fail for the old reason.

---

## Step 0 — Install the new APK (5 min)

- [ ] Download and install:
      `https://github.com/nekodas-neko/TrainingAI/releases/download/apk-latest/app-debug.apk`

This build carries the version fix, the chest-strap link-state fix, and five scale BLE fixes — none
of which are on your current install.

- [ ] **Open the app once and let the home screen fully settle. Then close it.**
      Do not skip this: the first launch after a new build re-caches the service worker, so any
      measurement taken now would describe the re-cache, not a normal start. This launch is the
      warm-up, not a measurement.

**Already worth reporting:** open **More** and look at the update banner. It should now say nothing
(you are up to date). If it still claims an update is available, that is a finding — the version fix
did not take.

---

## Step 1 — Cold start · **1b is done and it decides the question**

### ✅ Result — Q-1b (bundling the shell into the APK) should be DROPPED

The numbers you sent:

| | ms |
|---|---|
| Time to first paint (FCP) | **472** |
| of which: waiting for the document (TTFB) | **439** |
| JavaScript execution | **~15** |
| DOM interactive | 454 |

**Read:** 439 of the 472 ms is the round trip to Railway for the HTML document. The JavaScript —
87 files, all served from the service worker cache — parses and runs in about 15 ms. There is no
JavaScript problem to solve.

Bundling the shell into the APK removes exactly one thing: that 439 ms document fetch. It does not
touch native process start or Capacitor init. **So the entire prize is ~0.44 s**, for a large piece
of work, on a screen that already paints in under half a second. The threshold in this runsheet was
1.5 s. It is comfortably under.

**Recommendation: drop Q-1b.** If you want the app to *feel* faster, the 439 ms document fetch is
the thing to attack, and there are much cheaper ways in (serve the shell from the service worker
cache-first instead of network-first, so the document doesn't wait on the network at all).

### 1a — Screen recording ×3 — **optional now, low value**

Skip unless you want it. It would give the wall-clock number *including* native process start —
useful to know, but it cannot change the decision above, because bundling doesn't affect that part
either. If a cold start subjectively feels slow to you, do it and send them; otherwise move on.

> **Why this was never simply "record a Performance profile of a cold start".** Swiping the app away
> destroys the WebView, so the DevTools target disconnects; the relaunch is a *new* target you would
> have to re-attach to, by which time the cold start is over. No recording can span the kill.

**If you do run it:** no laptop needed. Android's built-in screen recorder, from the quick-settings panel.

Per run: start recording → swipe the app away from recents → wait 5 seconds → launch it → stop once
home is **fully painted** (streak, week strip and cards showing real numbers, no skeletons).

- [ ] Run 1
- [ ] Run 2
- [ ] Run 3

**Send the three videos.** At 60 fps that resolves to ~16 ms.

### 1b — ✅ DONE 2026-08-04, do not re-run

Kept for the record — this is the snippet that produced the numbers above.

The browser records navigation and paint timings from the moment the document starts loading, and
**keeps them for the life of the page**. So you can cold-start normally, attach afterwards, and read
numbers that were already captured.

1. Cold start the app normally (swipe away, wait 5 s, launch). Let home finish painting.
2. **Now** plug in, open `chrome://inspect/#devices`, click **inspect** under `com.trainingai.app`.
3. **Console** tab, paste this. It copies the result to your clipboard — just paste it back to me.

```js
copy(JSON.stringify((()=>{
  const n = performance.getEntriesByType('navigation')[0] || {};
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map(p=>[p.name, Math.round(p.startTime)]));
  // NOT getEntriesByType('largest-contentful-paint') — deprecated, returns nothing and logs a
  // warning. LCP is only readable through an observer; see the separate one-liner below.
  const lcp = null;
  const res = performance.getEntriesByType('resource');
  const js = res.filter(r=>r.name.endsWith('.js')||r.initiatorType==='script');
  const big = [...js].sort((a,b)=>(b.transferSize||0)-(a.transferSize||0)).slice(0,8)
    .map(r=>({kb:Math.round((r.transferSize||0)/1024), ms:Math.round(r.duration), url:r.name.split('/').pop().slice(0,50)}));
  return {
    ttfb: Math.round(n.responseStart||0),
    domInteractive: Math.round(n.domInteractive||0),
    domContentLoaded: Math.round(n.domContentLoadedEventEnd||0),
    loadEvent: Math.round(n.loadEventEnd||0),
    transferKB: Math.round((n.transferSize||0)/1024),
    firstPaint: paint['first-paint'] ?? null,
    firstContentfulPaint: paint['first-contentful-paint'] ?? null,
    largestContentfulPaint: lcp,
    resourceCount: res.length,
    jsCount: js.length,
    jsTotalKB: Math.round(js.reduce((s,r)=>s+(r.transferSize||0),0)/1024),
    biggestJs: big,
    ua: navigator.userAgent.slice(0,80),
  };
})(), null, 2))
```

- [ ] Pasted the output

`copy()` prints `undefined` in the console — that is its own return value, **not** an error. The JSON
is on the clipboard.

**LCP needs its own line**, because the `getEntriesByType` route for it is deprecated and silently
returns nothing:

```js
new PerformanceObserver(l => console.log('LCP', Math.round(l.getEntries().pop().startTime)))
  .observe({ type: 'largest-contentful-paint', buffered: true })
```

- [ ] LCP: ______

**Do this before tapping around.** Navigating resets nothing, but the resource list grows as other
tabs load their chunks, which muddies `jsTotalKB`.

### 1c — DevTools reload profile ×3 — **skip**

This existed to answer "is the cold start slow because of JavaScript or the network?". 1b answered
it outright: **the network**, 439 ms of 472. A reload profile would only re-measure the ~15 ms of
JavaScript in finer detail. Not worth the setup.

Kept below in case a later question needs it.

DevTools already attached, app open:

1. **Performance** tab → tick **Screenshots** → **Record**.
2. Focus the DevTools window and press **Ctrl-R** (Cmd-R on a Mac) to reload the WebView document.
3. Stop once home has repainted.

- [ ] Run 1
- [ ] Run 2
- [ ] Run 3

**Send the ⤓ Save profile `.json`** for each — worth far more than a screenshot, since it can be
read properly. Otherwise a screenshot of the panel with the filmstrip and the Summary donut.

**What this is and is not.** A reload re-fetches the document and re-parses and re-executes all the
JavaScript — **exactly the part bundling the shell into the APK would change**. It skips native
process start and Capacitor init, which bundling would not change anyway. So it is a fair proxy for
the question being asked, and unlike a true cold start it is fully recordable.

### The number that decides things

From the **screen recordings** (1a): time from tapping the icon to the first frame with real content.

| Time | What it means |
|---|---|
| under ~1.5s | already fine — **bundling the shell (Q-1b) gets dropped** |
| ~1.5–3s | worth reading where the time goes before deciding |
| over ~3s | genuinely slow; 1b and 1c say whether it is JavaScript or the network |

---

## Step 2 — Tab switching (3 min)

1. App open, home settled. Start a **Performance** recording.
2. Tap **Health** → wait for paint → **Workout** → wait → back to **Home**.
3. Stop.

- [ ] Recorded

**Expected:** the first tap on each tab is slower; going *back* to a tab you already opened should be
near-instant (all five panels stay mounted, we just flip visibility).

- [ ] **Was returning to an already-opened tab instant?** yes / no

**If no, say so loudly** — that means the tab prefetch shipped in v1.251.2 is not working, which is
a bug rather than a trade-off, and it changes what I work on next.

---

## Step 3 — 30 seconds idle (2 min)

1. Open the app, land on home, start recording, **do not touch the phone for 30 seconds.**
2. Stop.

- [ ] Recorded
- [ ] **Any repeating spike, roughly once a second?** yes / no

**Expected:** almost entirely idle after the first couple of seconds. A 1 Hz spike means a timer is
re-rendering the screen when it should not be — quietly eating battery. Also a bug, not a trade-off.

---

## Step 4 — Three admin checks, all in the app (5 min)

**a) Model asset delivery** — Admin → Tools → **Additional tools** → **Model asset delivery** → tap
**Check model assets**.

- [ ] Verdict: `complete` / `incomplete` / `unreachable` — **paste the line**

`complete` is the evidence that lets me delete 87 MB of model files from the code repo. `incomplete`
names which file is wrong. `unreachable` means the storage credentials are not reaching the app.
**Nobody has ever looked at this card** — if it renders wrong, that is the first thing to tell me.

**b) Raw store stats** — Admin → Oura Ring · direct BLE → **Raw store** → **Read stats**.

- [ ] Row counts, disk use, and the **low disk** flag: ______
      (if `low disk` reads YES, the service is shedding raw ring data and that needs following up)

**c) SpO₂ + ultradian staging** — Admin → Oura Ring · direct BLE → **Redecode** a night, then open
**Sleep epochs (debug)**.

- [ ] Is the **`spo2V`** column populated, or mostly blank? ______
- [ ] If populated: is it **higher in REM stretches than deep ones**, or flat? ______
- [ ] Paste a dozen rows.
- [ ] Same redecode answers the ultradian question: does **REM now fall in recurring bands roughly
      every 95 minutes** rather than drifting late, and does the night's REM% sit nearer 23–28%?

Blank or flat is a **valid answer** and gets recorded, not tuned around.

---

## Step 5 — Offline behaviour, airplane mode (10 min)

**First: force-close and reopen the app.** #1046 fixed a sync fault where every body-metric write
was failing on the phone; several checks below write body metrics, and without the reload they would
fail for the old reason and read as a new bug.

Turn **airplane mode on** and keep it on for all of these.

- [ ] **Log a workout on a day you have *already* trained and synced today.** Go to **Home**.
      Expected: the week strip's dot for today shows **both** sessions, and the streak / "This Week"
      count includes it — immediately. This second-workout case is the one that was broken.
- [ ] **Save a walk or a workout**, then open **Health → Training**. Expected: the day gets its dot
      immediately, before anything syncs.
- [ ] **Turn the network back on.** Expected: both stay, and neither doubles up.

Then, still in this step:

- [ ] **Sync-health card** — More → sync health → tap **Retry**. Expected: the dead-lettered row
      clears. (Its fix shipped in #987 but the stuck row will not re-attempt on its own.)
- [ ] **Cold open the app.** Expected: your local data renders straight away. This confirms the
      SQLite open-path recovery from #988, which has never been checked.

---

## Step 6 — Chest strap label (no walk needed any more)

**The 10-minute cadence walk is cancelled** — see the revision note at the top. The database already
holds a strap-sourced activity with `cadence_spm = 120.1` and a full per-10-second series, so both
halves of that question (does it read, does it save) are answered yes.

What is left is the label fix, which is a desk check. **Strap off your chest and out of range**,
More → Profile:

- [ ] Within ~4 minutes the label moves `Connecting…` → `Strap not reachable — retrying` →
      `Not connected — tap Connect, or it connects during workouts`, and a **Connect** button
      appears. (Before this fix it said "Connecting…" forever.)
- [ ] **Put the strap on and tap Connect.** Expected: reaches `Connected · on your chest` without
      restarting the app.

**Next time you do a GPS run or walk anyway** — no special trip required:

- [ ] **Activity heart rate** — open it from the activity list. Expected: it shows an average and max
      heart rate. These were blank on every GPS activity before. (18 of 43 activities carry an
      `avg_hr` today, so this is checking the *new* ones, not the history.)

---

## Step 7 — Railway console, no phone needed

Three one-time database jobs. The third is the big one.

- [ ] **WAL trim + Postgres restart** — the step `docs/db-volume-cleanup-handover.md` left as
      "recommended, not yet confirmed done".
- [ ] `VACUUM (VERBOSE, ANALYZE) oura_raw_samples`
- [ ] `REINDEX TABLE CONCURRENTLY oura_raw_samples` — **reclaims ~130 MB.** Re-measured 2026-08-04:
      the table is now **462 MB, of which 316 MB is indexes** (it was 452/306 when this was written —
      still growing), and roughly 130 MB of that index size is bloat. `CONCURRENTLY` keeps the table
      online but is slower and needs disk headroom for a second copy of each index — **check free
      space first.**

---

## Optional — only if you have a spare account

- [ ] **Readiness without a ring** — the Readiness screen should show a number with the line
      "Based on part of the usual picture …" rather than being blank. **On your own device this
      should be unchanged** — if your Readiness detail suddenly reads "limited", that is a
      regression, not the feature.

---

## Anything odd? One extra thing worth reporting

If **Body Battery or Readiness on Home shows an error or goes blank**, tell me — even in passing.
Both routes 500'd in production on 2026-08-03 and left no trace, because neither had any error
handling. They now report to the database with a full stack, so a single recurrence is enough for me
to read the cause remotely. **You do not need to capture anything** — just mention that it happened.

---

## What I do with each result

- ~~**Cold start under ~1.5s** → Q-1b gets dropped.~~ **Done — 472 ms measured, Q-1b dropped.**
- ~~**Cadence yes/no** → closes Q-47.~~ **Done — answered yes from the database.**
- **A 1 Hz idle spike, or a slow return to an open tab** → those get fixed first. Both are bugs, not
  trade-offs.
- **Model assets `complete`** → 87 MB of model files leave the code repo.
- **`low disk: YES` on the raw store** → the BLE service is shedding ring data; that jumps the queue.
- **Anything in Step 5 not appearing immediately** → the offline-first read path is still wrong
  somewhere, which is the bug class this project has hit most often.
