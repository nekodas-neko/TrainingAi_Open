# Handoff — 2026-08-02 · Batch queue drain (owner unblocks applied)

_Domain: `platform` (routes work into `devices`, `readiness`, `workouts`, `activity`, `sleep`, `app-shell`) · Branch: `claude/trainingai-onboarding-metj23` · PR: none yet_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/implementation-backlog.md` (the queue and its protocol), then the domain index for
> whatever you pick up (`docs/domains/<pillar>/README.md`). This file is not a plan — it is the
> owner's answers to the four questions that were blocking the queue, plus an ordered run-list
> derived from them.

## Goal

The queue had ~14 open items and most sessions were stalling on the same four unanswered
questions. The owner answered all four on 2026-08-02. This doc records those answers and turns
them into a run-list an implementer session can work top-down without stopping to ask again.

## Owner decisions — 2026-08-02

These are answers, not proposals. Do not re-open them.

### 1. Phase 3 / the Next.js-vs-native question — **defer, do not cancel**

> *"If you have other tasks then work on them first. But based on our roadmap we will get this
> working before we move to the native build — so that still needs to be done eventually; but we
> can push it till we HAVE to do it."*

- **Q-1 stays in the queue and stays real.** Phase 3 (bundle the shell into the APK) is still
  expected to ship *before* any native rewrite. It is deprioritised, not abandoned — do not write
  it off, and do not let a future session delete the entry as superseded.
- **Do not provision the second Railway `api/` service** and do not re-land the #952 workspace
  split. That is the owner/infra action gating it, and it stays unspent while other work exists.
- **Q-31 and Q-32 remain `⛔ blocked`** — they gate on Q-1 landing. See §5 for the one part of
  Q-31 that is *not* blocked.
- The architecture research prompt in
  [`docs/handoff-2026-08-02-platform-offline-architecture-review.md`](handoff-2026-08-02-platform-offline-architecture-review.md)
  is not cancelled either; it just isn't this batch's work.

### 2. Device access — **yes, one consolidated checklist**

Owner will install a fresh APK and work through a single checklist covering everything at once.

- **Kotlin/native items are takeable.** Q-40 E3 and Q-29 D2 Task 5 are no longer device-gated out
  of the batch.
- **Accumulate every device check into one list** — `## Owner device checklist` at the bottom of
  this file. Append to it as you ship; do not hand the owner a new checklist per PR.
- Two checks are **already owed** before anything you add (both carried over from the Q-36/Q-37
  batch, neither done):
  1. **Tap Retry on the sync-health card.** Q-36's fix shipped in #987, but the already
     dead-lettered row does not re-attempt on its own.
  2. **Confirm Q-37 on device.** It merged in #988 unverified; its `projectOverview.md`
     Known-Issues row (line ~989, "Local SQLite open-path recovery … NOT verified on device")
     stands until someone looks.
- Standard rule still applies: anything you ship that you cannot verify in-session gets a
  Known-Issues row saying so. The checklist does not replace that row — it is how the row gets
  cleared later.

### 3. Production database — **access confirmed working, use it**

The owner said it should already be set up. **It is — verified live this session.**

Worth being precise, because the obvious check misleads: `CLAUDE_DB_READONLY_URL` is **unset in
the sandbox**, which looks like the feature is off. It isn't. That variable is read by the
route on Railway, not by you. What the sandbox needs is `CLAUDE_DB_QUERY_SECRET`, which **is**
set. Verified end-to-end on 2026-08-02:

```bash
curl -s -X POST "https://trainingai-production.up.railway.app/api/admin/db-query" \
  -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT 1 AS ok"}'
# → {"rows":[{"ok":1}],"rowCount":1,"truncated":false,"durationMs":46,"fields":["ok"]}
```

Constraints, from `app/api/admin/db-query/route.ts`: single SELECT against the `claude_ro` view
schema only, max 1,000 rows, max 5 MB, rate-limited 10/min per IP, every query audited into
`db_query_log`. Read-only is enforced by the `claude_readonly` Postgres role, not by SQL
inspection. It is scoped to the owner's rows only.

**This unblocks the measure-first items** — Q-28 and Q-41 finding 4 in particular. There is no
longer an excuse to defer them for want of data.

### 4. `oura_raw_samples` volume — **cheap fix only**

> *"Do the cheap version instead."*

- **Take Q-35.** Stop JSON-decoding `motion_event`/`motion_period`, and replace the dedup index's
  embedded full-text `body_hex` with a generated `body_hex_hash` column. Zero behaviour change,
  ~10 MB of index reclaimed, correct whichever way D4 goes.
- **Do not build the `body_hex` TEXT→bytea migration** (Q-30 §5 / Finding 4). Explicitly declined
  — it becomes throwaway work when D4 drops the table.
- Q-30's remaining no-code steps (WAL trim + Postgres restart, `VACUUM (VERBOSE, ANALYZE)
  oura_raw_samples`) go on the owner checklist — they are Railway-console actions, not a PR.
- **Annotate Q-30 in the backlog** with this decision so the next session doesn't re-raise it.

### 5. The Oura-IP problem — **elevated, needs a plan before any code**

> *"This is a big one — we need to figure out fast how we will do this in the future; or how we
> will obscure this part from our public github repo when we move to it."*

Context: Q-31's entry claims two live imports of Oura's extracted proprietary constants. The
import graph says **seven** — including SleepNet (the hypnogram) and `step_counter` (daily
steps), both user-visible. The "delete the tree" step the entry is built on cannot succeed as
written. That annotation is already in the backlog; what's new is the owner calling it urgent.

**What to do — and what not to.** Do not start swapping constants. The next move is a **docs-only
planning PR** that produces a triage decision per module: replace with our own maths, replace
from a public source, or gitignore-and-keep. The owner's steer is that both routes are on the
table and it is case-by-case. Two have plausible public substitutes and should lead: the workout
MET table (Compendium of Physical Activities) and training-stress. SleepNet and `step_counter`
are gitignore-not-replace for now — but see C1 in
[`docs/device-agnostic-source-architecture.md`](device-agnostic-source-architecture.md), the
owner does want them replaced eventually.

This is a **plan**, not an implementation, and it is not blocked by Q-1 — the thinking can happen
now even though the repo cut can't. Rewrite the Q-31 entry against the real import graph in the
same PR.

## The run-list

Ordered. Take the top ready item, one per session run, per the backlog protocol. Every item
follows the normal gate: feature branch off fresh `main` → `pnpm dev` exercising the changed
routes and flows → CI green → merge. Docs-only items merge with no ceremony.

**Ships through Railway** = JS/TS/server, reaches the device with no rebuild. **Needs APK** =
Kotlin/native, goes on the device checklist.

| # | Item | Branch | Plan | Ships via | Notes |
|---|---|---|---|---|---|
| 1 | ✅ **Q-43** Health Connect first-class source tier — **shipped v1.250.0**, see [`docs/overview/entries/2026-08-02-health-connect-source-tier.md`](overview/history-2026-07-30.md). Follow-up **Q-45** filed. | `feat/health-connect-source-tier` | done | Railway | Ingest path never ran against a real Health Connect provider — Known-Issues row added, device check below. |
| 2 | ✅ **Q-38** prescription empties after a phase transition — **shipped v1.250.1**, see [`docs/overview/entries/2026-08-02-prescription-phase-transition-regen.md`](overview/history-2026-07-30.md). | `fix/prescription-phase-transition-regen` | done | Railway | Verified end to end at the S25 viewport on the dev server; no device check needed (no native surface). |
| 3 | ✅ **Q-39** Body Battery anchor flips mid-day — **shipped v1.250.2**, see [`docs/overview/entries/2026-08-02-body-battery-anchor-stability.md`](overview/history-2026-07-30.md). Q-42 left as the follow-up, untouched as instructed. | `fix/body-battery-anchor-stability` | done | Railway | Reproduced and re-verified on the dev DB; both themes checked at 360px. No device check needed. |
| 4 | ✅ **Q-40** chest-strap card stuck on "Connecting…" — **shipped v1.250.3**, E1/E2/E3 all taken, see [`docs/overview/entries/2026-08-02-chest-strap-link-status.md`](overview/history-2026-07-30.md). | `fix/chest-strap-link-status` | done | E1/E2 Railway · **E3 needs the new APK** | Kotlin did not compile locally (no Android SDK); CI's Android job is the gate and passed. Two device checks added below. |
| 5 | ⚠️ **Q-35** `oura_raw_samples` footprint — **retired, not built.** Measured against prod: Finding 1 was already done by Lever 1 (0 of 740,966 rows carry `decoded`), and Finding 4's sha256 column would have made the table *bigger* (sha256 is 32 bytes; `body_hex` averages 24 chars). Replaced by **Q-46** + a `REINDEX` on the checklist. See [`docs/overview/entries/2026-08-02-oura-raw-samples-footprint-remeasured.md`](overview/history-2026-07-30.md). | `fix/oura-raw-samples-footprint` | docs-only | — | Migration 166 was claimed and then **not used** — it is still free. |
| 6 | ✅ **Q-31 re-scope** — Oura-IP triage plan written: [`docs/superpowers/plans/2026-08-02-oura-ip-triage.md`](superpowers/plans/2026-08-02-oura-ip-triage.md). Audit confirms seven live imports and finds an **eighth module that is *production*-unreachable** (`inference/dhrv`) — ⚠️ **corrected 2026-08-02: NOT "deletable today"**, its unreachability is deliberate and documented (`docs/module-map.md`: the ONNX path "stays golden-tested but unreachable from production **until D7**"). See the Q-49 A0 entry. Entry rewritten. **One owner question now blocks the gitignore strategy** — see below. | `docs/oura-ip-triage-plan` | docs-only | — | No code touched; Q-31's implementation stays blocked behind Q-1/Q-30 as instructed. |
| 7 | ✅ **Q-28** measured, **not built** — a full restore is ≈1,800 rows across the twenty delta domains, the low end of the item's own scale, so it drops down the queue. Tripwire recorded: `oura_heartrate` is 37,950 rows and deliberately *not* in the delta; adding any timeseries domain makes this urgent in the same PR. See [`docs/overview/entries/2026-08-02-applydelta-restore-sized.md`](overview/history-2026-07-30.md). | `perf/applydelta-batching` | docs-only | — | Second "measure first" item this batch to come back "don't build it". |
| 8 | ✅ **Q-41** activity-payload hardening — **all four findings closed.** Findings 2/3/4 in v1.250.4 ([entry](overview/history-2026-07-30.md)); **finding 1 in v1.250.11** ([entry](overview/history-2026-07-30.md)) as an *overlay of unsynced local rows*, the middle path that satisfies both halves of the owner's contradictory answer. Finding 4 was unanswerable and is re-filed as **Q-47** (which then found its own premise wrong — see run 2). | `fix/activity-payload-hardening` · `fix/calendar-local-first` | done | Railway | Finding 2 not run against a real GPS activity; the calendar overlay has never produced a row in any test — two device checks added. |
| 9 | ✅ **Q-33** admin console `rawStats()` card — **shipped v1.250.5**, see [`docs/overview/entries/2026-08-02-admin-raw-store-status-card.md`](overview/history-2026-07-30.md). | `feat/admin-raw-stats-card` | done | Railway | Native-only by construction; the populated numbers have never been read — device check added. |
| 10 | ⏭️ **Q-29 D2 Task 5** — port the rollup to the WebView. **Not started in run 2, deliberately: sized at 1,100 lines** (`adapter.ts:4664–5764`) of the app's most load-bearing derivation. Split the plan before coding — Steps 1–4 (pure `rollupNight` + fidelity tests, sandbox-TDD) is a separate PR from Steps 5–6 (bridge wiring) and Step 8 (device). | per the on-device program | [`2026-07-21-oura-raw-on-device-phase-1.md`](superpowers/plans/2026-07-21-oura-raw-on-device-phase-1.md) | **Needs APK** | Large. Read [`docs/oura-ondevice-hybrid-implementer-progress.md`](oura-ondevice-hybrid-implementer-progress.md) for live state first. Retention constraint (owner, 2026-08-02): raw frames are kept on-device for a **14-day rolling window**, ~25,200 rows/day — the rollup must run, push and release frames inside that window, with a bound and a visible failure state. |
| 11 | ✅ **Q-10** degenerate sleep rows — **shipped v1.250.8**, see [`docs/overview/entries/2026-08-02-degenerate-sleep-session-skip.md`](overview/history-2026-07-30.md). Fixed as a **zero-duration** skip, not the 20-minute floor the entry asked for — only the one zero-duration row can produce the null, and a floor would discard genuine fragmented-night windows. | `fix/degenerate-sleep-session-skip` | done | Railway | Pure TypeScript in the shared package; no native, safe-area or device surface. Verified against the un-fixed code. Q-10's remaining nice-to-have (persist Oura's session `type`) stays in the backlog. |
| 12 | ✅ **`sleep_sessions.oura_id`** global-unique collision — **shipped v1.250.7, migration 166**, see [`docs/overview/entries/2026-08-02-sleep-oura-id-user-scope.md`](overview/history-2026-07-30.md). Constraint moved to `(user_id, oura_id)`. | `fix/ble-sleep-id-user-scope` | done | Railway (migration auto-applies on deploy) | Next free migration number is now **167**. |
| 13 | ⚠️ **Q-34** sleep-staging heuristic upgrades — **item 1 was already on `main`** (plan stale); **item 3 (SpO₂ variability) shipped v1.251.0** ([entry](overview/history-2026-07-30.md)), its verdict blocked on a device check; **items 2 and 4 remain** | per the plan | [`2026-07-11-oura-ble-sleep-staging-phase1b-signal-upgrades.md`](superpowers/plans/2026-07-11-oura-ble-sleep-staging-phase1b-signal-upgrades.md) | Railway | Four upgrades, cheapest-first. Sandbox-buildable. Take only if the batch has room. |

### Do not pick up

| Item | Why |
|---|---|
| **Q-1** Phase 3 | Deferred by owner decision 1. Still real, still eventually required — do not delete the entry. |
| **Q-31** implementation | Blocked on Q-1 + Q-30, *and* mis-scoped. Item 6 above rewrites the plan; it does not build it. |
| **Q-32** public repo cut | Blocked on Q-1 + Q-30 + Q-31. |
| **Q-30** bytea migration | Explicitly declined (decision 4). |
| **Q-42** readiness-composite extraction | Follow-up to Q-39; only worth it if the provisional-anchor window still bothers the owner after item 3 ships. |
| **Q-3b(a)**, **Q-4**, **Q-11** | Owner/data-gated on ground truth that doesn't exist yet (sleep ratings, H10 sleep wear, device HR capture). Prod SQL does not unblock these — they need new data collection. |
| **Dependabot standing item** | Below threshold: 2 high, both the same `sharp`/libvips advisory transitively via `next`. Fixing means a major `next` bump — its own PR, not a drive-by. |

## Gotchas that will otherwise cost you a session

- **The backlog file warns about itself, and it's right.** Re-verify any entry against `main`
  before building it. Q-31 is the live proof: its stated premise is false. If a plan is stale or
  the work is already done, remove the entry via a docs-only PR with a one-line reason rather
  than forcing a mismatched implementation.
- **`CLAUDE_DB_READONLY_URL` being unset in the sandbox does not mean prod access is off.** See
  §3. Check by calling the endpoint, not by reading env vars.
- **DB-backed tests are flaky in the full suite and pass in isolation.** Re-run a failing file on
  its own before reporting it. Stop any `pnpm dev` server first — it competes for connections.
- **Kotlin only compile-gates here.** No Android SDK in the sandbox and the Gradle download is
  proxy-blocked. CI builds the APK and publishes it to the rolling `apk-latest` release.
- **Migration numbers collide in this repo** (081, 087, 146, 161 each claimed twice). Claim 166
  against the directory *and* open PRs before writing one.
- **`pnpm`, never `npm`** — Railway deploys with `--frozen-lockfile`.

## Files worth reading before you start

- `docs/implementation-backlog.md` — the queue and its protocol. Long; the Queue section starts
  around line 100.
- `docs/db-volume-cleanup-handover.md` — the existing full diagnosis behind Q-30/Q-35. Do not
  re-investigate.
- `docs/oura-ondevice-hybrid-implementer-progress.md` — live state of the on-device program
  (gates item 10).
- `docs/device-agnostic-source-architecture.md` — why Q-43 matters and where the IP question in
  §5 is heading.
- `docs/device-smoke-checklist.md` — the concrete on-device verification steps.

## Owner device checklist

> **▶ For a single sitting, use [`docs/device-runsheet-2026-08-04.md`](device-runsheet-2026-08-04.md)
> instead.** It merges every unchecked item below with the cold-start profiling into one ordered
> pass — install, profile, admin checks, airplane-mode items, strap + walk, Railway console — so
> nothing gets set up twice. This list stays the master record; the runsheet is the running order.

**Append to this list as you ship. Do not start a second one.** The owner installs one APK and
works through this in a single pass.

Carried over, already owed:

- [ ] **Tap Retry on the sync-health card** (More → sync health). Q-36's fix is in #987 but the
      dead-lettered row won't re-attempt itself. Confirm the row clears.
- [ ] **Confirm Q-37** — the local SQLite open-path recovery from #988. Open the app cold, confirm
      local data renders. Clears the Known-Issues row in `projectOverview.md`.

Owner **decisions** needed (not device checks — these block work):

- [x] ~~**Is the public repo a fresh `git init`, or a push of this repo's history?**~~ ✅
      **Answered 2026-08-02: a brand-new repo, i.e. a fresh `git init`.** No history carried over,
      so `.gitignore` genuinely covers the 43 MB of vendored model assets. Recorded in
      [`docs/superpowers/plans/2026-08-02-oura-ip-triage.md`](superpowers/plans/2026-08-02-oura-ip-triage.md).
- [x] ~~**Should the training calendar merge unsynced local activities?**~~ ⚠️ **Answered
      2026-08-02, but the answer was internally contradictory** and the reading taken is recorded
      here so it can be corrected cheaply. The owner said *"go with your recommendation"* (which
      was: sanction the gap, leave it server-only) **and** *"the calendar should read the local
      database first anyway"* (which is the opposite). **Taken as: make the calendar local-first**,
      because that sentence is unambiguous and it matches CLAUDE.md's offline-first rule. Backlog
      **Q-41** now describes that work. If the sanction reading was meant, say so — the entry flips
      back to a one-line note.
- [x] ~~**Is `steps-motion-decoder` a protocol decode or model constants?**~~ ✅ **Answered
      2026-08-02: gitignore it.** It is an input adapter for one device; every other device
      supplies decoded step data through Health Connect anyway. Filed with rows 5 and 6 as
      replace-later, not permanent-keep.

Railway-console actions, no APK needed (from decision 4):

- [ ] **WAL trim + Postgres restart** — the step `docs/db-volume-cleanup-handover.md` left as
      "recommended, not yet confirmed done."
- [ ] **`VACUUM (VERBOSE, ANALYZE) oura_raw_samples`** — checks whether
      `idx_oura_raw_samples_user_measured` is bloat or live data. **Answered 2026-08-02: it is
      bloat.** 107 MB against a ~28 MB ideal, from 1,324,792 updates of which 19 were HOT.
- [ ] **`REINDEX TABLE CONCURRENTLY oura_raw_samples`** — measured 2026-08-02: the table is 452 MB
      (146 MB heap + **306 MB indexes**) over 740,966 rows, and roughly **130 MB of that is index
      bloat**. `CONCURRENTLY` avoids taking the table offline; it is slower and needs the disk
      headroom for a second copy of each index, so check free space first. This is the largest
      single reclaim available and needs no deploy. The code-side guard that stops it
      re-accumulating is backlog **Q-46**.

Added by implementer sessions:

- [ ] **Health Connect tier (Q-43, v1.250.0)** — More → Health/Devices, switch **Health Connect on**
      and run a sync. Expected: sleep from the phone appears on the Sleep screen for a night the ring
      did not record, and a night the ring *did* record keeps the ring's numbers (the phone must not
      overwrite them). If the phone's provider stages sleep, the hypnogram on that night's Sleep
      detail shows stages rather than only the four totals. Nothing here has ever run against a real
      provider — this is the check that clears the `projectOverview.md` row.
- [ ] **Chest-strap label (Q-40, v1.250.3)** — More → Profile, with the strap **off your chest and
      out of range**. Expected within ~4 minutes: the label moves `Connecting…` → `Strap not
      reachable — retrying` → `Not connected — tap Connect, or it connects during workouts`, and a
      **Connect** button appears next to Forget. Before this it said "Connecting…" indefinitely.
      **Needs the new APK** — the final-status emit is Kotlin.
- [ ] **Chest-strap manual reconnect (Q-40)** — with the label at "Not connected", put the strap on
      and tap **Connect**. Expected: it reaches `Connected · on your chest` without restarting the
      app. The JS half of this ships through Railway, so it works on the current APK too — but the
      "Not connected" state that reveals the button only appears reliably with the new one.
- [ ] **Activity heart rate (Q-41, v1.250.4)** — finish a GPS **run or walk** (not treadmill) and
      open it from the activity list. Expected: it shows an average and max heart rate. Before this
      those were blank on every GPS activity. Ships through Railway — no new APK needed.
- [ ] **Raw store stats (Q-33, v1.250.5)** — Admin → Oura Ring · direct BLE → **Raw store** → tap
      **Read stats**. Expected: real row counts, disk use and a low-disk flag. This is also the §4
      runbook's retention check, so the numbers themselves are worth having — if `low disk` reads
      YES, the service is shedding raw rows and that needs following up. No new APK.
- [ ] **Readiness without a ring (Q-43)** — only if you have a spare account or the friend can look:
      the Readiness screen should show a number with the line "Based on part of the usual picture …"
      rather than being blank. On the owner's own device this should be **unchanged** — if the
      Readiness detail suddenly reads "limited", that is a regression, not the feature.

- [ ] **Does cadence get measured at all? (Q-47)** — the diagnostic that unblocks a queue item, not
      a fix to confirm. Wear the **chest strap** and make sure it reads `Connected · on your chest`
      first, then walk for **10+ minutes** using a guided walk or a normal walk activity. Watch the
      live **cadence readout** on the active screen: does it ever show a number? Then open the saved
      activity — does it show an "spm avg"? Production has **zero** activities with a cadence value
      ever recorded, across all 42, so a plain yes/no here is the whole answer. If the live readout
      shows numbers but the saved row does not, say so — that is a different bug from the one
      expected. Ships through Railway, but the strap fix it depends on (Q-40) **needs the new APK**.

- [ ] **Calendar shows an unsynced day (Q-41, v1.250.11)** — put the phone in **airplane mode**,
      save a walk or a workout, then open Health → Training. Expected: the day gets its dot
      immediately, before anything syncs. Turn the network back on and confirm the dot stays (it
      must not double up or disappear). This overlay has never produced a row in any test — the web
      sandbox has no local store — so this check is the whole verification. Ships through Railway.

- [ ] **Is the SpO₂ staging signal alive? (Q-34 item 3, v1.251.0)** — Admin → Oura Ring · direct BLE
      → **Redecode** a night, then open **Sleep epochs (debug)** and look at the new **`spo2V`**
      column. Two separate questions, both needed: (a) is it *populated* — it needs ≥ 5 SpO₂ readings
      inside a 5-minute epoch, and the ring's oximeter cadence has never been measured against that
      bar, so mostly-blank is a real possible answer; (b) if populated, does it *separate* — higher in
      REM stretches than in deep ones, or roughly flat throughout? Paste a dozen rows. Flat or blank
      is a valid negative result and gets recorded rather than tuned around. **The same Redecode also
      answers Q-34 item 2 (the ultradian ~95-min cycle prior, v1.251.1)** — one look at the redecoded
      ribbon covers both: does REM now fall in recurring bands roughly every 95 minutes rather than
      drifting late, and does the night's REM% sit nearer the ~23–28% Cloud-era baseline? Ships
      through Railway.

- [ ] **Streak counts an unsynced workout (Q-41 last surface, v1.252.2)** — same shape as the
      calendar check above, but the case that was actually broken is the **second** workout in a
      day. In **airplane mode**, on a day you have *already* trained and synced, log a second
      workout, then go back to **Home**. Expected: the week strip's dot for today shows both
      sessions and the streak/"This Week" count includes it, immediately. Before this, that second
      session was invisible on Home until it uploaded (a workout on a *fresh* day already showed —
      that part was never broken, contrary to what the backlog entry said). Turn the network back on
      and confirm it does not double up. Ships through Railway — no new APK.

- [ ] **Are the models coming from the bucket? (Q-49 A1 gate, v1.252.3)** — Admin → Tools →
      **Additional tools** → **Model asset delivery** → tap **Check model assets**. Expected:
      `Object storage: complete`, and eight file sizes listed. **Paste the verdict line** — a
      `complete` is the evidence that unblocks deleting the `.onnx` files from git and making the
      boot check fatal, which is the last step of Q-49 Phase A1. `incomplete` names which file is
      wrong and means the upload script needs re-running; `unreachable` means the Railway storage
      credentials are not reaching the app and is a different problem. This replaces the old
      "read the deploy logs for eight lines" step — that gate could not work (the model loaders are
      lazy, so the lines only appear once a sleep rollup runs). **The card itself has never been
      looked at** — it is behind two client-side toggles and this repo has no React render tests, so
      if it renders wrong, that is the first thing to say. Ships through Railway — no new APK.

_(Implementer sessions: add your items here, each naming the screen and the expected result.)_

## Pickup prompt

```
You are picking up a batch queue-drain on TrainingAI.

Branch: start each item on its own feature branch off freshly-fetched main
(git fetch origin main && git remote prune origin && git checkout -B <branch> origin/main).

Read in this order:
1. projectOverview.md — current status and Known Issues
2. docs/handoff-2026-08-02-platform-batch-queue-drain.md — the owner's four unblocking
   decisions and the ordered run-list. Start here for what to do.
3. docs/implementation-backlog.md — the queue protocol
4. docs/domains/<pillar>/README.md for whichever pillar your item sits in

First action: take item 1 from the run-list — Q-43, Health Connect as a first-class source
tier, branch feat/health-connect-source-tier, plan at
docs/superpowers/plans/2026-08-02-health-connect-first-class-tier.md. A real user sees blank
score cards today. The owner capped the scope: degradation plus the saveSleepSession
provenance fix, nothing more.

Constraints you would otherwise rediscover:
- Phase 3 (Q-1) is deferred by owner decision but NOT cancelled — do not provision the second
  Railway api/ service, and do not delete the entry. Q-31 and Q-32 stay blocked.
- Production read-only DB access works from the sandbox. POST to
  https://trainingai-production.up.railway.app/api/admin/db-query with
  Authorization: Bearer $CLAUDE_DB_QUERY_SECRET and {"sql":"SELECT ..."}. Verified 2026-08-02.
  CLAUDE_DB_READONLY_URL being unset locally is expected and does not mean it is off.
- The owner will install ONE new APK and run ONE checklist. Kotlin items are in scope. Append
  every device check to the "Owner device checklist" section of the handoff doc — do not start
  a second list. Two checks are already owed there.
- Do not build the body_hex TEXT→bytea migration; the owner declined it. Take Q-35 instead.
- Next free Postgres migration number is 166 — claim it against the directory AND open PRs.
- Anything you cannot verify in-session ships with a Known-Issues row in projectOverview.md
  saying exactly which surface was not exercised.
- Merge policy: feature branch, pnpm dev exercising every changed route and flow, CI green,
  then merge without asking — except destructive/irreversible changes (data-dropping
  migrations, auth/session/security, secrets), which are confirm-first.
```
