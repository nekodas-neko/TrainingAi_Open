# Owner Action Required — what's left that the sandbox can't do

**Last updated:** 2026-07-21 (post W7 §6.1 offline food search + deload badge) · Maintained by implementer sessions.

> **⚠️ Corrected 2026-07-30: this document is stale and not being kept current** — it mixes its
> 2026-07-21 header with a few later additions (through 07-28) but has not tracked the large amount
> of work shipped since. **Do not treat this as the authoritative "what's left" list** — that claim in
> `projectOverview.md` referencing this doc is itself stale. For current state, use
> `docs/implementation-backlog.md` (the Native APK holding pen and the owner-gated entries scattered
> through its Queue cover the same ground as this file, kept current) plus `projectOverview.md`'s
> Known Issues & Risks tables. This file is kept for historical items not yet re-verified elsewhere;
> verify anything below against `main` before acting on it.

**Context.** Every backlog item that can be **built and verified in the cloud sandbox is done** (see
`docs/implementation-backlog.md` and `docs/planned_upgrades.md`). The 2026-07-20 session shipped the
full **wiring & caching-perf audit batch (W1–W7)**, **cumulative-stress (ChronicStress) rollup wiring
Chunk 1**, and the two W4 surface items (run-explain narration + prescription volume pills, v1.185.0).
The 2026-07-21 session then shipped the **exercise-history deload badge** (W4 §5.7, v1.186.0), the
**builder-review stable row key** (W6 §2.4), and **offline food-library search** (W7 §6.1, v1.187.0).
What remains needs **your physical Samsung S25 Ultra, an APK rebuild, real ring/strap data, a
production deploy, or a product decision** — none of which a headless cloud session can perform. This
document is the single list of those items, grouped by the kind of action needed. Work top-down; §1
is time-sensitive.

> How to read this: each item says **what**, **why it's blocked here**, and **what you do**. Where a
> feature merely needs confirmation it works on-device, run the relevant sections of
> [`docs/device-smoke-checklist.md`](device-smoke-checklist.md) (a ~5-minute pass).

---

## 1. ⏰ Time-sensitive — do this first

- **Run the per-workout HR-stats backfill before ~January 2027.**
  - *What:* `POST /api/oura-ble/backfill-hr-stats` (admin-only; bounded + resumable — re-POST until the
    response says `remaining:false`).
  - *Why:* P4b (v1.177.0) added a durable per-workout HR snapshot (`workout_hr_stats`) but only writes
    it on first recap view. A 90-day `rr_intervals` prune will eventually reach *pre-P4b* workouts that
    have no snapshot; back-fill them from the still-present raw series before the prune erases it.
  - *You do:* hit that admin endpoint a few times from the S25 while signed in as admin.

---

## 2. 📱 APK rebuild required (native code — compile-gated in CI only)

Native Kotlin/Java changes are compiled by the Android CI job but **cannot be run** here (no Android
SDK; Gradle download is proxy-blocked). To take effect on your ring, rebuild the APK:

```bash
npx cap sync android && cd android && ./gradlew assembleDebug
# then install the debug APK on the S25
```

- **✅ R-1 — native BLE cursor hole-jump race (HIGH) — CODE FIXED (v1.181.2), needs your rebuild.**
  - *What was wrong:* `OuraRingService` set the `drainIngestFailed` flag on the main thread while the
    next batch's guard read it on the ingest thread, so a BLE batch that succeeded *after* a failed one
    could advance the history cursor past the failed span → **silent, permanent loss of ~one ≤255-event
    history batch per incident.**
  - *Fixed (on `main`):* `drainIngestFailed` is now `@Volatile`, set synchronously on the ingest thread
    the instant a POST fails, and re-checked before the cursor advances (`postDrainBatch`). It can now
    only ever hold the cursor and re-drain (dedup-safe), never jump a hole. Documented as ops row I18.
  - *You do:* **rebuild the APK** (`npx cap sync android && ./gradlew assembleDebug`) so the fix takes
    effect, then confirm a **Full re-sync** completes cleanly per `docs/oura-ble-operations.md` §4 — the
    only real proof is on-device drain behaviour, which the sandbox can't run.
- **Warm-up / bar-load status-bar chip countdown** (v1.181.0) — the JS half is coupled to a native
  `MainActivity.java` change; the Railway WebView deploy alone is **not** sufficient. Rebuild, then
  confirm the Now Bar pill counts *down* and goes red/negative past target.
- **Native chest-strap foreground service** (v1.180.0, #670) — all-day / screen-off Polar H10 HR
  capture. Rebuild, then confirm background streaming + reconnect + `/api/hr-ingest` posting.
- **Other native BLE work still parked** (all need a rebuild, listed for completeness): durable
  background sync remainder (item 12), the col14 gate port (items 1/2/3 Chunk 3), per-epoch clock
  anchor (item 5), native steps decode (item 6 / P-D).

---

## 3. 🔬 On-device smoke tests (shipped, working in `pnpm dev`, NOT yet device-verified)

These are already on `main` and pass the web gate, but the sandbox can't exercise native SQLite,
Capacitor plugins, safe-area insets, gestures, or notification delivery. Each has a Known-Issues row
in `projectOverview.md`. Run the relevant `device-smoke-checklist.md` sections:

- **Always-on chest-strap HR + "activity in progress" notification** (v1.177–v1.180).
- **Running plan Phase 1** — offline-first completion, safe-area on the run screens, guided-activity
  hand-off (`/running`).
- **Fitness baselines** (`/baselines`) — 6MWT / Cooper / resting-HRR with live HR + GPS + native
  SQLite + safe-area.
- **Rest-timer & warm-up status-bar chips** (Android 16 Live Update).
- **Health-alerts notifications** (v1.169.0) — LocalNotifications no-op in the sandbox; confirm one
  actually fires.
- **P4b HR recap summary** — open a completed workout's recap; confirm avg/peak/HRR1/HRV render and
  persist.
- **Error-surfacing APK surfaces** (P5) — dead-store banner, dead-letter toast, strap re-buffer.
- **Offline-first native paths** — R3 Chunk 3.1/3.2 local mirrors + Chunk 4 sync machinery; nutrition
  offline meal-types (item 10, airplane-mode); WK-13 cross-midnight rollover; WK-16 on a non-AEST
  device.
- **Per-screen wallpapers** (Batch L) — Samsung WebView rendering in both light and dark theme.
- **Admin BLE console** (`/admin/oura-ble`) — only renders with the native plugin present.
- **Cardio surfaces (2026-07-20):** the Heart Rate page's **observed-HR profile card** (v1.182.0),
  the **"are you making progress?" card** (v1.183.0), the **`/running` goal-picker + weekly zone
  targets** UI, and the **admin data-capture panel** (`/admin/data-capture`) — all shipped; confirm
  they render on the S25 WebView and populate once the ring/strap has fed a few sessions.
- **Workout render-perf (W2, v1.184-series):** the active-workout screen's weight/rep hot path was
  moved to self-subscribing leaf components. Values are provably identical — this smoke only confirms
  the *feel*: log several sets across exercises, confirm no stale displayed weight/reps, the rest ring
  + lap/rest counters still tick, and live-1RM + warmup update as the set-1 weight changes.
- **Run-explain narration + prescription volume pills (v1.185.0):** confirm the prescribed-run card
  shows the warm AI sentence (and degrades to the plain rationale offline / when the AI is down), and
  the AI-prescription card's per-muscle `sets/wk` pills render and sum sensibly.
- **Offline food search (v1.187.0):** airplane-mode, open the food logger — the My-Foods search, the
  build-a-meal ingredient search, and the "recently logged here" quick-pick should all return your
  previously-logged foods with no signal (web can't test this — `getLocalStore` is null there).
- **Deload badge (v1.186.0):** open a past deload week in exercise history and confirm the amber
  "Deload" pill shows on those Session Log rows (server path; transiently absent offline until the
  fetch lands).
- **Offline saved-meal CRUD (v1.188.0):** airplane-mode → create a saved meal from previously-logged
  foods (appears instantly), edit it, delete it; confirm a pending count in More→sync-health; reconnect
  and confirm all three land server-side and the pending count clears. Also confirm "add a new food
  from scratch" shows the needs-connection message offline. Entirely native-SQLite — unverifiable on web.
- **Scale passive-scan background sync (v1.237.0):** toggle "Sync in background" on in Settings >
  Scale, then leave the app closed/backgrounded and step on the scale — confirm no persistent
  notification appears beforehand, a brief "connecting…"/"syncing…" notification appears during the
  actual weigh-in, and it clears within a few seconds. Reboot the phone with the toggle still on and
  weigh in again to confirm `ScaleBootReceiver` re-armed the scan. First PendingIntent-scan pattern
  in this codebase — no working reference to compare against if it misbehaves.

---

## 4. 📡 Data captures (wear the ring / strap, do the activity)

The sandbox has only the always-fresh local seed, so anything that depends on **your real ring data or
the prod database** can't be validated here:

- **Validate BLE-derived nightly metrics vs your Oura baselines.** SpO₂ reads ~3 pts low overnight
  (gen-4 "SpO₂ Simple" quadratic) — if the gap holds over a few nights, add a per-ring offset in
  `lib/oura-ble/spo2.ts`. Also cross-check HRV rMSSD, resting HR, and wear-time against your Cloud-era
  screenshots.
- **Enable + decode ring steps over BLE.** REAL_STEPS (`0x0b`) is off by default; enable it, then walk
  exactly N steps and screenshot the decoded-fields inspector before/after to identify the step field
  (backlog "Ring steps over BLE").
- **Validate the step-counter column mapping** (`unpack27` → `data_columns`, and the `0x47` motion
  mapping) vs a phone step count, using the admin step-counter console.
- **BDI real-night validation** — a worn-overnight SleepNet dump to confirm the neural apnea head
  produces a sane value before the BDI display is un-gated.
- **Prod-only display check** — the Readiness/Sleep sparklines + Body Battery morning anchor coalescing
  our own derived scores over frozen Cloud only diverge in production (the local seed is always
  Cloud-shaped-fresh). Eyeball them after a deploy on a live day.

---

## 5. 🧭 Owner decisions (I need a direction before building)

- **P-A Lever 5 — aged `body_hex` cold-storage.** Data-dropping, so confirm-first. Recommended shape:
  compress/move `body_hex` older than ~12 months (keeps re-decode), never a hard delete. **Proceed?**
- **P-F P3 — vascular-age PPG spike.** Needs an on-device PPG capture GO/NO-GO before the port. **Want
  the spike?**
- **WK-18 — `calendar_event` offline outbox** (last open piece of backlog item 8). Low value: calendar
  creation is an online-only Google side-effect and already shows a retry-by-tap failure toast; a full
  synced outbox domain is a lot of device-unverifiable machinery. **Build it, or drop it from the
  backlog?** (My recommendation: drop.)
- **F3 running plan Phase 2** (volume adaptation + multi-week look-ahead). Pure-TS and sandbox-buildable,
  but gated on Phase 1 being device-smoked first (§3). **Smoke Phase 1, then tell me to build Phase 2.**
- **Cumulative-stress (ChronicStress) — Chunk 1 SHIPPED, now needs your data + a Chunk-2 decision.**
  The two missing HRV series turned out to be computable from the raw per-beat IBI we already decode
  (you unblocked this), so the model is wired into the rollup and golden-verified. But it produces a
  **null score until ≥21 nights of real ring data** exist in the window, and the first score only
  appears after a **wide/full rollup pass** covers that history. **You do:** wear the ring ~3 weeks,
  let a full re-aggregate run, then **tell me if the first score looks plausible** vs how you feel /
  Oura's old ChronicStress. Two hardcoded values need your real-data calibration: the
  **fever-deviation limit** (`TEMP_DEV_FEVER_LIMIT_C = 1.0°C`, biased against over-masking) and the
  **30-sec hypnogram** (up-sampled from our 5-min stager — coarsens the fragmentation index). **Only
  after you confirm a sane value** do I build **Chunk 2** (the Health ChronicStress card) — no point
  rendering an unvalidated number.
- **Item 23a(b) — static accessory styles on `manual` programs.** Only matters if you see a
  manual-program accessory reading light; the fix mutates stored user program data (confirm-first).
  **Flag it if you hit it.**
- **✅ Scale background-sync passive BLE scan — SHIPPED v1.237.0 (owner chose the rework).**
  Raised 2026-07-28 during the first real on-device weigh-in; owner chose the passive-scan rework
  (specifically because it enables frictionless multiple-times-a-day weigh-ins with no ongoing
  notification cost) over leaving the 45s-poll design or turning background sync off. Replaced
  `ScaleBleService`'s continuous retry loop with `ScaleBleScanManager`
  (`BluetoothLeScanner.startScan(..., PendingIntent)`, filtered on the FFE0 service UUID) +
  `ScaleScanReceiver` (wakes the service only when the scale actually advertises) +
  `ScaleBootReceiver` (re-arms the scan after a reboot). **Needs an on-device smoke** (§3): this is
  the first PendingIntent-scan pattern in this codebase — no working reference to lean on, and
  Samsung's BLE stack has already surprised this project once (`autoConnect`). Confirm: detection
  fires promptly on a real weigh-in, the scan survives a reboot, and no ongoing notification
  appears between weigh-ins.
- **✅ Offline saved-meal create/edit/delete — SHIPPED v1.188.0 (owner chose to build it).** Saved
  meals are now a full offline-first write domain (SQLite v16 tables + outbox `saved_meals` + local-first
  read). Needs an **on-device smoke** (§3): airplane-mode create/edit/delete from logged foods → confirm
  instant list update + a pending count in More→sync-health → reconnect → confirm all three land
  server-side. Scope note: "add a brand-new food from scratch" is intentionally still online-only (shows
  a needs-connection message offline) — picking previously-logged foods works offline.

---

## 6. 🔑 Access / provisioning

- **Dependabot remediation.** I can't enumerate the GitHub security-dashboard alerts (no MCP tool
  exposes the alerts API, and there's no authenticated browser here). `pnpm audit` is currently clean
  against the resolved lockfile. When the dashboard shows **≥5 high/critical**, either grant dashboard
  access or paste the alert list and I'll bump the deps in a grouped PR.
- ~~**Thunderforest map tiles.**~~ ✅ DONE (2026-07-27) — `NEXT_PUBLIC_THUNDERFOREST_API_KEY`
  provisioned and set in Railway (redeployed). Referrer-restriction isn't offered on the Hobby
  Project (free) tier, so the key is unrestricted — accepted risk for a personal project.

---

## Not in scope (endgame projects — need their own planning session, not listed above)

- Bundle-the-shell-into-the-APK + native FCM push (removes the online-only web fallback; the
  E6 cron/proactive layer rides on this).
- wasm-SQLite in the browser (one local-first path on web too) — against the current APK-only policy.
- Progress photos / voice logging (device camera/mic) — unplanned Batch O features.
