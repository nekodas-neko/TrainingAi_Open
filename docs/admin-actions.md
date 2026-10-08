# Admin, maintenance and debug actions: catalogue

Read-only research against `main` in `/home/user/TrainingAi_Open`, 2026-10-06. This extends
`docs/admin-control-inventory.md` (OR-115 / #2250) and does not contradict it. That doc sorts each
**card** by nature (diagnostic / remedy / one-off) and recommends keep, hide or delete. This one goes
down to each **button**: what it calls, its scope, whether it is safe to repeat, and how dangerous
it is. The inventory's findings still hold. There are two admin surfaces, `/admin` (with
`/admin/oura-ble`, `/admin/cadence` and `/admin/data-capture` under it) and
`/more/settings/developer`. Nothing is unreachable. The "one-off" header on the set-HR backfill was
wrong, and #2379 fixed it.

**Auth legend.** *admin session* means the route calls `requireAdmin` on the NextAuth session, and
the page itself is `isAdminUser`-gated. *native* means a Capacitor `OuraBle` plugin method, which
runs only in the APK and has no server auth. *user session* means any signed-in user. *local* means
browser or device storage only. **No write route in this catalogue accepts a bearer token.** The
only bearer routes are reads: `db-query` and `replay` (`CLAUDE_DB_QUERY_SECRET`), `day-review`
(`ADMIN_EXPORT_SECRET`) and `db-snapshot` (`ADMIN_SNAPSHOT_SECRET`).

**Danger legend.** none · slow (long server job or radio time) · ring-state (changes the ring's
on-device config) · **destructive** (data or credentials are lost or rewritten, and cannot be undone
in the app).

Line numbers point at the `<Button>` or `onClick` line.

---

## 1. `/admin/oura-ble`: step 1 "Before you start" (server only, works on desktop)

| Screen > section > button | File:line | Calls | What it does | Scope | Safe to repeat? | Auth | Danger | When to run |
|---|---|---|---|---|---|---|---|---|
| Oura BLE > 1 > DB footprint > **Null historical decoded (Lever 1b)** | `components/oura-ble/db-footprint-card.tsx:214` (confirm dialog) | `POST /api/oura-ble/samples/backfill-null-decoded` | Sets the `decoded` JSONB to NULL on historical `oura_raw_samples` rows. `body_hex` is kept, so every row can still be redecoded. | full history | Yes, idempotent. A second press continues if `remaining > 0`. Rate limit 4/min. | admin session | **destructive** (low). The dropped column can be rebuilt from `body_hex`, but not by this button. | Only when the footprint shows `decoded` rows and the disk is filling. Follow it with VACUUM. |
| … > **Reclaim disk — VACUUM FULL (Lever 1c)** + table picker | `db-footprint-card.tsx:238` (confirm) | `POST /api/admin/vacuum {table}` (allowlist `VACUUM_FULL_TABLES`: `oura_raw_samples`, `error_events`, …) | Rewrites one table to give dead-tuple space back to the OS. No rows are lost. | one table | Yes, idempotent. Rate limit 4/min. | admin session | slow. Takes an ACCESS EXCLUSIVE lock, so **the APK's ingest blocks while it runs**. | After Lever 1b, after a Pack, or when `error_events` has bloated. |
| … > **Pack sealed frames (Lever 5)** | `db-footprint-card.tsx:245` (confirm) | `POST /api/oura-ble/samples/pack` | Moves sealed buckets older than 7 days from `oura_raw_samples` into compact blobs in `oura_raw_packed`. Each bucket is proved equal by re-reading it, and only then are the originals **deleted**. | full history (sealed only) | Yes, idempotent. A bucket that cannot be proved equal is refused and left alone. Rate limit 10/min. | admin session | **destructive**. It is the only control that deletes archival rows. ⚠ CLAUDE.md says "Never prune or mutate the server raw archive", and the dialog says "moved, not discarded". The owner should treat it as confirm-first. | When disk pressure calls for it, then VACUUM `oura_raw_samples`. |
| … > Refresh icon / **Device metrics panel** | `db-footprint-card.tsx:193`, `device-metrics-panel.tsx:14` | `GET db-stats`, `GET samples/pack`, `GET admin/vacuum`, `GET device-metrics` | Reads only. | n/a | yes | admin session | none | Before any Lever. |

## 2. `/admin/oura-ble`: step 2 "Drain & re-sync" (`OuraBleDebug`, APK only)

### 2a. Ring key

| Button | File:line | Calls | What it does | Scope | Repeat? | Auth | Danger | When |
|---|---|---|---|---|---|---|---|---|
| Ring key > **Save** (shown only when no key is stored) | `components/oura-ble/oura-ble-debug.tsx:448` | native `setKey({hex})` | Stores the 32-hex ring key in the phone's keystore. | device | Yes, it overwrites. | native | **destructive if the hex is wrong**: the old key is replaced, although the field only appears when no key exists. | First setup, or recovering from a key backup. |
| Ring key > **Show key for backup** / **Copy** / **Hide** | `:459`, `:464`, `:465` | native `revealKey()`, clipboard | Shows the key so it can be backed up. Nothing changes. | device | yes | native | none (but it puts a credential on screen and on the clipboard) | Before any uninstall, device change or APK re-sign. |
| Data · Ingestion · Retention > Danger zone > **Clear key** | `:614` | native `clearKey()` | **Deletes the ring's BLE key from the phone.** | device | n/a | native | **DESTRUCTIVE AND IRREVERSIBLE** unless the key was backed up. It has **no confirm dialog**: one tap on a ghost button. Without the key the ring cannot be reached, and per CLAUDE.md recovering it means re-onboarding through the official Oura app, which is forbidden. | Practically never. ⚠ It needs a confirm, or should be removed (see finding F1). |

### 2b. Primary actions

| Button | File:line | Calls | What it does | Scope | Repeat? | Auth | Danger | When |
|---|---|---|---|---|---|---|---|---|
| **Sync & Redecode** | `:486` → `syncAndRedecode` `:387` | native `ensurePermissions` + `startService` (if stopped), native `drainHistory()`, a **fixed 4 s wait**, then `runRedecodeJob('')`, which does `POST /api/oura-ble/samples/redecode?async=1` and polls `GET ?jobId=` | Drains new ring events, then re-runs every server decoder and the **full-history** rollup. | ring: since cursor. Server: **full history**. | Yes, idempotent. The server allows one job at a time, and a second press follows the running job (a plain redecode or a step backfill; both do the full redecode). Rate limit 4/min. | native + admin session | slow (a full-history re-aggregate, minutes; the cause of a 2026-08-13 outage before it moved off the request loop) | After a release that changes a decoder, the sleep stager or a rollup step. ⚠ The 4 s wait is not tied to the drain finishing. Frames that land later are rolled up by the normal incremental ingest, but **this** full-history pass misses them. |
| **Sync now** | `:489` → `syncNow` `:255` | native `startService` (if stopped) + `drainHistory()` | Pulls new ring history from the resume cursor. Native ingest POSTs `/api/oura-ble/samples` and triggers the incremental rollup. | since cursor | Yes, idempotent. The server dedups. | native | none | Any time data looks stale. |
| **Start** / **Stop** | `:493` / `:498` | native `ensurePermissions` + `startService` / `stopService` | Starts or stops the background BLE service. | device | yes | native | Stop halts all background sync until the next Start. | Troubleshooting. |
| **Allow** (battery exemption banner) | `:514` | native `requestBatteryExemption()` | Opens the Android dialog for battery-optimisation exemption. | device | yes | native | none | One-time setup. |
| Recorded to server > refresh icon | `:528` | `GET /api/oura-ble/samples/summary` | Reads only. | n/a | yes | admin session | none | |

### 2c. Domain sections

| Button | File:line | Calls | What it does | Scope | Repeat? | Auth | Danger | When |
|---|---|---|---|---|---|---|---|---|
| Data · Ingestion · Retention > History & sync > **Drain history** | `:608` | native `drainHistory()` | Same as **Sync now**, but it does **not** start the service if it is stopped. | since cursor | yes | native | none | Duplicate of Sync now. |
| … > **Full re-sync** | `:609` → `fullResync` `:272` | native `drainHistory({fromZero:true})` | Re-pulls the ring's **entire** buffer from cursor 0. | full ring buffer | Yes, idempotent. The server dedups. No confirm. | native | slow (long radio time and battery, heavy ingest) | After a recovery, re-key, decoder or protocol change, or dropped data (runbook §4). |
| … > **Redecode** | `:610` → `redecode` `:282` | `runRedecodeJob('')` (same as above) | Server-only full-history redecode and re-aggregate, with no drain. | **full history** | yes (single-flight) | admin session | slow | After a decoder or rollup release, when the ring data is already on the server. **Duplicate:** Sync & Redecode = Sync now + this. |
| Sleep > Frames > **Dump sleep frames** | `:625` | `GET /api/oura-ble/samples/raw?tags=49,4c,…&limit=200` | Writes sleep-family frames to the log. | newest 200 | yes | admin session | none | Decoder investigation. |
| Sleep > Sleep epochs (debug) > **Compute** | `:638` → `sleepEpochs` `:398` | `POST /api/oura-ble/samples/redecode?date=D&dump=1` | Per-epoch staging diagnostic for one night. ⚠ **It is not a pure read.** The `dumpOnly` path runs the windowed rollup (`lib/oura-ble/rollup/run.ts`), and the sleep, body_metrics, hr_series and other steps are not gated on `dumpOnly`. Only the watermark write is skipped (`run.ts:1273`). It rewrites the recent window, just as an ingest rollup would. | one date for output. Writes: recent window. | Yes, deterministic. Uses the redecode rate limit (4/min). | admin session | none in practice | Tuning the stager. |
| Steps · Activity · Energy > Accelerometer > **Accel** / **Stop accel** | `:648` / `:649` | native `startAccel` / `stopAccel` | Streams raw 0x33 accelerometer data. | live | yes | native | ring-state (battery) | Step investigation. |
| … > Measurements > **Enable measure** | `:659` | native `enableMeasurement()` | Turns the ring's measurement features back on. | ring config | yes | native | ring-state | Restores state after Measure OFF or Steps OFF. |
| … > **Enable steps** | `:660` | native `setFeatureMode({0x0b, 0x01})` | Sets REAL_STEPS to automatic. | ring config | yes | native | ring-state | |
| … > **Feature status** | `:661` | native `featureStatus()` | Reads only (to the log). | n/a | yes | native | none | |
| … > **Steps OFF** | `:662` | native `setFeatureMode({0x0b, 0x00})` | Turns ring step recording off. | ring config | yes | native | **ring-state**: no step data until it is turned back on | Probe only. |
| … > **Measure OFF** | `:663` | native `setFeatureMode` ×3 (DAYTIME_HR, SPO2, REAL_STEPS set to 0) | Turns **daytime HR, SpO₂ and steps** off on the ring. The code comment says they come back on at reconnect via Enable measure. | ring config | yes | native | **ring-state**: daytime data is lost until it is restored | Probe only. The label does not say it turns off HR and SpO₂. |
| … > Frames > **Dump step frames** | `:671` | `GET samples/raw?tags=7e,7f,50,51,52&limit=120` | Writes frames to the log. | newest 120 | yes | admin session | none | |
| … > Step calibration > **Mark start** | `step-calibration.tsx:241` | calls `onSync` = **Sync now** (drain) then reads | Drains the ring and records a ds marker. | since cursor | yes | native | none | Step calibration. |
| … > Step calibration > **Sync + compute** / **Compute only** / **Clear** | `:244` / `:247` / `:287` | drain + `GET samples/raw?tags=7e,7f` / read / local state | Gate estimate over the marked span. Clear empties the capture list in the page. | marked span | yes | native + admin session | none (Clear drops the unsaved captures on screen) | |
| … > Live step test > **Auto capture: ON/OFF** | `live-step-test.tsx:277` | localStorage flag | When ON, detected walks briefly turn measurements off, capture accel and post steps. | device setting | yes | local | ring-state while active | Off by default. |
| … > Live step test > **Start live test** / **Stop** | `:313` / `:312` | radio lock + native `startAccel` / `stopAccel` | Counts steps live from accel. | live | yes | native | ring-state (radio is exclusive) | |
| … > Live step test > **Save result** | `:333` | `POST /api/oura-ble/live-steps` (upsert; a failure is queued in localStorage) | **Product write.** Stores a counted step window that the rollup merges into that day's steps. | one window (today) | Yes, an upsert per window. | user session (not admin-gated) | none, but it changes a real day's steps | After a counted walk. |
| … > Continuous step capture > **Continuous capture: ON/OFF** | `continuous-capture-card.tsx:65` | `getContinuousCapture().setEnabled()` | When ON: REAL_STEPS is off 07:00–22:00-ish, accel streams, and chunks post for gait counting. | ongoing | yes | native + user session | **ring-state**, battery, and step data depends on the app staying alive | Production experiment toggle. |
| … > **Diagnostics JSON** / **Copy** | `:80` / `:81` | local | Exports diagnostics. | n/a | yes | local | none | |
| Cardio · Body-comp > Connection > **Battery** / **Info** / **SyncTime** | `:702` / `:703` / `:704` | native `readBattery` / `readInfo` / `syncTime` | Reads, except SyncTime, which sets the ring clock. | ring | yes | native | SyncTime: low ring-state (clock anchor) | |
| … > Heart rate > **Live HR** / **Stop HR** / **Fast-HR on** / **Fast-HR off** / **Exercise-HR live** / **Daytime-HR live** / **HR burst** | `:710`–`:716` | native `startLiveHr`, `stopLiveHr`, `fastHr`, `setFeatureMode({0x03,0x03})`, `setFeatureMode({0x02,0x03})`, `triggerHrBurst` | HR investigation levers. | live, ring config | yes | native | ring-state (feature modes persist until changed), battery | Investigation only. |
| … > Diagnostics > **HR coverage** | `:720` | `GET samples/raw?tags=80,60,86&limit=1000` | Lists HR gaps longer than 3 min. | newest 1000 | yes | admin session | none | |
| … > Battery soak > **Start soak** / **Stop soak** / **Copy soak JSON** | `battery-soak-test.tsx:66` / `:65` / `:82` | `getBatterySoak()` (REAL_STEPS off, continuous accel) | Measures how fast the battery drains while streaming. Stop restores steps. | multi-hour | yes | native | **ring-state** until Stop (steps not recorded) | Battery study. |
| Log & frames > **Copy** / **Clear** | `log-console.tsx:28` / `:38` | local | Copies or clears the on-screen log. | n/a | yes | local | none | |

## 3. `/admin/oura-ble`: step 3 "Verify what landed"

| Button | File:line | Calls | What it does | Scope | Repeat? | Auth | Danger | When |
|---|---|---|---|---|---|---|---|---|
| Raw store > **Read stats** | `raw-store-status-console.tsx:60` | native `rawStats()` | On-device raw-store row counts, disk use and low-disk flag. | device | yes | native | none | Runbook step 3b, after every drain you care about. |

## 4–5. `/admin/oura-ble`: steps 4 "Validate" and 5 "Feasibility probes" (all read-only GETs)

All of these are admin session, safe to repeat, and have no danger. **Compare** (`comparison-harness-console.tsx:59`, `GET comparison-harness?minutes=`) · **Compare** (`dhrv-comparison-console.tsx:62`, `…&metric=hrv`) · Live HR test **Start / Stop / Measure now** (`live-hr-test-console.tsx:105/107/113`, live-HR manager, radio only) · **Run** (`step-counter-export-console.tsx:68`, `GET step-counter-export`) · **Probe** ×3 (`workout-sensor-probe-console.tsx:58`, `daytime-coverage-console.tsx:61`, `ring-battery-console.tsx:62`).

One exception:

| Button | File:line | Calls | What it does | Scope | Repeat? | Auth | Danger | When |
|---|---|---|---|---|---|---|---|---|
| SleepNet neural stager — dump > **Run dump** | `sleepnet-dump-console.tsx:66` | `POST /api/oura-ble/samples/redecode?date=D&dump=1` | Same route as Sleep > **Compute**. The card says "does not change the staging stored", but per the code it re-runs the windowed rollup (see 2c). | one date | yes | admin session | none in practice | **Duplicate** of Sleep epochs > Compute: one call, two renderings. |

## 6. `/admin/oura-ble`: step 6 "Maintenance & corrections"

| Button | File:line | Calls | What it does | Scope | Repeat? | Auth | Danger | When |
|---|---|---|---|---|---|---|---|---|
| Ring re-key > **Declare a re-key** (+ note) | `rekey-declaration-card.tsx:130` (confirm) | `POST /api/oura-ble/rekey` | Records a pending declaration. The **next drain** consumes it and opens a new clock epoch. | next drain onward | **No.** A second declaration after the first is consumed opens a second epoch. Rate limit 5/min. | admin session | **destructive / irreversible once consumed**: every timestamp in the epoch depends on it. A wrong declaration re-times history. | Only right after re-keying with `open_oura`. |
| Ring re-key > **Cancel declaration** | `:118` | `DELETE /api/oura-ble/rekey` | Withdraws a pending declaration that has not been consumed. | pending row | yes | admin session | none | Only if the declaration was a mistake and no drain has happened yet. |
| D0 historical step backfill > **Preview backfill** | `step-backfill-console.tsx:75` | `GET /api/oura-ble/samples/step-backfill-preview` | Lists the days whose step count would drop. | full history | yes | admin session | none | |
| … > **Run backfill now** | `step-backfill-console.tsx` (confirm) | `runRedecodeJob('allowStepsDecrease=1')`, a **full-history redecode** with the "steps only go up" guard lifted | Rewrites inflated historical step days **downward** to the step_counter total. Manual entries are untouched. If a plain Redecode is already running, the server **refuses with 409** and starts nothing ("A redecode is already running. Wait for it to finish, then run the backfill."), and the console says *Not started … Nothing was changed.* It says *Done. Backfill applied* only when the finished job's `kind` (read from the job row by the status poll) is `step-backfill` (issue 2383, F9). | full history | Idempotent once applied, but the old values are gone. A second press during a running backfill follows that backfill. | admin session | **destructive** (the old step values are not recoverable). slow. | One-off D0 correction. A third caller of the full-history redecode. Run it when no Redecode or Sync & Redecode is in flight. |
| Daytime-stress bucket backfill > **Dry run** | `stress-backfill-console.tsx` | `runRedecodeJob('stressBackfill=1')`, i.e. `POST /api/oura-ble/samples/redecode?async=1&stressBackfill=1` (dry run is the default) | Computes, from stored data, which past days would gain `oura_daytime_stress_buckets` rows, and reports it. **Writes nothing.** Uses the rollup's own series builder (`lib/oura-ble/rollup/stress-series.ts`) over the raw frames (both tiers, read-only), the nightly summary baselines, the fitted daytime-HRV model and the recorded sleep windows. | full history | yes | admin session, `rateLimit` 4/min, strict query | slow (a full-history raw read, in the rollup worker, in the one job slot) | Before the write, always. Compare its numbers to the write's (see the entry below). |
| … > **Add N buckets** | `stress-backfill-console.tsx` (confirm; offered only after a dry run found something to add) | `runRedecodeJob('stressBackfill=1&dryRun=false')` | **Adds** the missing buckets. **Add-only (issue 2236):** it never deletes a bucket and never changes one. A day that already has any bucket is skipped whole, and each insert is `ON CONFLICT DO NOTHING` on `(user_id, bucket_mid)`. Today is left to the forward writer. A day it cannot score (no raw data, no model, no HRV or resting-HR baseline, no temperature, no scorable bucket) is reported with the reason and gets nothing. One transaction that **rolls back** unless the rows written equal the rows planned. It is a separate job kind (`stress-backfill`), so a plain redecode, a step backfill or another full-history pass cannot join it or be joined by it: a request while another kind runs gets **409**, nothing started. The console says *Done … added* only when the finished job's `kind` is `stress-backfill` and its report says it was not a dry run. | full history | yes: a second run finds every day populated and adds 0 | admin session | additive only; no deletes, no overwrites. slow. **Production run: snapshot first** (policy below). | One-off, by the owner or the Orchestrator, after a verified snapshot and a dry run whose numbers were read. NOT behind the future agent key. |

### 6a. Running the stress-bucket backfill in production (issue 2236)

Policy (docs/rules/git-safety-and-packages.md): it only adds rows, but it is a production write, so
the order is fixed. The owner or the Orchestrator runs it, never an agent on its own.

1. **Snapshot first**: take a database snapshot and verify it restores (as for any production write).
2. **Dry run** (the default): `POST /api/oura-ble/samples/redecode?async=1&stressBackfill=1`, then poll
   `GET ?jobId=…`. The finished job carries `stressBackfill`, the report, and `kind:
   "stress-backfill-dry-run"`. Nothing is written.
3. **Read the report and compare**:
   - `range` and `daysConsidered`: completed days that have a nightly summary row.
   - `daysSkippedPopulated`: days that already have buckets. Expect the days the forward writer
     covered (production history begins 2026-08-24, about 26 buckets a day).
   - `daysToGain` and `bucketsToAdd`: expect roughly 20 to 26 buckets for each gaining day.
   - `daysCannotCompute`, `cannotComputeByReason` and `cannotCompute`: each such day gets nothing, with
     its reason (`no-raw-data`, `no-daytime-hrv-model`, `no-night-hrv-baseline`,
     `no-resting-heart-rate`, `no-temperature-in-day`, `no-scorable-buckets`). Depth is bounded by the
     packed raw tier (`oura_raw_packed`), so very old days will report `no-raw-data`.
   - `depth`: first and last day that would gain buckets. This is the achieved back-fill depth.
4. **Write**: the same request with `&dryRun=false`. The job's `kind` is `stress-backfill`, and its
   report has `dryRun: false` and `bucketsWritten`, which must equal the dry run's `bucketsToAdd`
   (the transaction rolls back and the job reports an error if they differ).
5. **Confirm**: run the dry run again. Expect `daysToGain: 0`, `bucketsToAdd: 0`.

If the job slot is held by a redecode, a step backfill or a run of the other stress kind, the request
gets 409 and starts nothing; wait for the running job, then ask again. A second press of the same kind
follows the running job.

## 7. `/admin` (tabs)

| Screen > section > button | File:line | Calls | What it does | Scope | Repeat? | Auth | Danger | When |
|---|---|---|---|---|---|---|---|---|
| Admin > users > **activate / deactivate icon** (UserCheck / UserX, no visible text; `aria-label` Activate / Deactivate) | `app/admin/admin-content.tsx` (`UserRow`) | `PATCH /api/admin/users {userId, action}` | Turns a user's `isActive` on or off. Deactivate opens a confirm naming the user; activate is one tap. | one user | yes | admin session | Fixed (#2383 item 3): the route refuses to deactivate the signed-in admin (`400 Cannot deactivate yourself`, the same shared check DELETE uses, before any write), and the admin's own row shows no deactivate icon. A deactivated user is sent to `/pending` (`auth.ts`) until an admin activates them. | Approving invitees. |
| … > **delete icon** (Trash, pending users only) | `:395` | `DELETE /api/admin/users` | **Hard-deletes** a pending user. | one user | no | admin session | **destructive**, no confirm | Rejecting a signup. |
| Admin > invites > **+** / **trash icon** | `:214` / `:222` | `POST` / `DELETE /api/admin/invites` | Adds or removes an invite email. | one email | yes | admin session | low | |
| Admin > feedback > **Delete** → **Confirm delete** | `:340` → `:326` | `DELETE /api/admin/feedback/[id]` | Deletes a feedback report. The response is not checked: the row is removed from the UI even if the call failed. | one row | n/a | admin session | **destructive**: BugFix reads this inbox | After the report is triaged into an issue. |
| Admin > devices > 3 rows | `:247–249` | navigation | Opens `/admin/oura-ble`, `/admin/cadence` or `/admin/data-capture`. | | | | none | |
| Admin > exercises > Exercise GIFs > **Mirror all** | `components/admin/exercise-manager.tsx:530` | `POST /api/admin/mirror-dataset-gifs {exerciseName}` per exercise, 300 ms apart | Mirrors dataset GIFs for exercises that have none (or only an external mirror). | whole library | yes (skips covered ones) | admin session | slow | After adding exercises. |
| … > **AI all** | `:533` | `POST /api/admin/generate-exercise-media` per exercise without a GIF, 1.5 s apart | **One paid AI generation per uncovered exercise.** No confirm and no count shown first. | whole library | Yes, it skips covered ones. Cost scales with the gap. | admin session | **money** (AI spend) | After Mirror all leaves gaps. |
| … > **Stop** (progress banner) | `:597` | local abort flag | Stops a bulk loop. | | | | none | |
| … > **Review GIFs** → **Wrong** / **Looks right** | `:548` → `gif-review-sweep.tsx:147/156` | `PATCH /api/admin/exercise-media-review` | Records a review verdict. No AI call. | one GIF | yes | admin session | none | |
| … > AI style reference > **Upload / Replace** | `:570` | `POST /api/admin/reference-figure` (multipart) | Replaces the style-anchor image that every AI generation uses. | global | yes | admin session | low (the old image is overwritten) | |
| … > per-row **Download icon** (mirror / re-mirror) | `:688` | `mirror-dataset-gifs` (confirm only if it would overwrite) | Mirrors or re-mirrors one GIF. | one exercise | yes | admin session | overwrites the existing GIF | |
| … > per-row **Sparkles / RefreshCw icon** (generate / regenerate) | `:698` | `generate-exercise-media` with `force` when one exists (confirm on overwrite) | One AI generation. | one exercise | Costs money each time. | admin session | money, overwrites | |
| … > per-row **Trash icon** | `:716` (confirm) | `DELETE /api/admin/exercises?name=` | **Hard-deletes** a library row and its GIF cache. There is no `deleted_at` tombstone, which conflicts with the offline-first rule. | one exercise | no | admin session | **destructive** | Rarely. |
| … > **Add** / form **Sparkles** / **Save** | `:609` / `:168` / `:211` | `POST /api/exercises/generate` (AI fills details) · `POST` or `PATCH /api/admin/exercises` | Creates or edits an exercise. A rename shows a warning (`:172`), because references are by name. | one | yes | admin session (generate: user session plus rate limit) | rename can orphan references by name | |
| Admin > activities > **Add** / **Save** / **pencil** / **trash icon** | `components/admin/activity-type-manager.tsx:164` / `:86` / `:204` / `:212` | `POST`, `PATCH` or `DELETE /api/admin/activity-types` | Manages activity types. Delete is refused while the type is in use (409) and for `other`. | one | yes | admin session | delete: low (guarded), **no confirm, no aria-label** | |

## 8. `/more/settings/developer` (the six bare cards and the diagnostics rows)

**Since #2379 (#2250) the six cards sit in three groups:** *Checks* (model assets, time audit,
program export), *Heart-rate backfills* (both), and *One-off repairs*, where **Fix lbs logged as kg
is folded behind a disclosure** and loads nothing until it is opened. The buttons below are
unchanged.

| Button | File:line | Calls | What it does | Scope | Repeat? | Auth | Danger | When |
|---|---|---|---|---|---|---|---|---|
| Workout time audit > **Set to today** / **Clear** | `components/admin/time-audit-card.tsx:120` / `:124` | `POST /api/admin/timing-baseline {date}` | Sets or clears the monitoring baseline date that the audit counts from. | setting | yes | admin session | low | After a timing-model change, to measure from then. |
| … > header toggle / **30 / 90 / … day chips** / **Retry** | `:103` / `:131` / `:142` | `GET /api/admin/time-audit?days=` | Reads only. | N days | yes | admin session | none | |
| Program export > header / **Copy** / **Refresh** | `program-export-card.tsx:50` / `:78` / `:85` | `GET /api/admin/program-export` | Reads only. | active program | yes | admin session | none | |
| Fix lbs logged as kg > **Preview** | `exercise-unit-fix.tsx:150` | `POST /api/admin/fix-exercise-units {apply:false}` | Dry run. | chosen exercises before a date | yes | admin session | none | |
| … > **Apply — converts N session(s)** | `:189` (confirm) | `POST /api/admin/fix-exercise-units {apply:true}`, which calls `applyLbsToKgFix` | Multiplies stored set weights, 1RM, target80, volume and PR by the lbs→kg factor. | chosen exercises before a date | **NO, it is not idempotent.** There is no marker, so a second apply converts again (weights × 0.4536²). This was read from `lib/data/postgres/adapter.ts:3866`. It is also a server-only write, and whether device SQLite picks it up was not checked. | admin session | **destructive** | Once per confirmed unit mistake. |
| Backfill per-set HR stats > **Run backfill** | `hr-backfill-card.tsx:59` via `set-hr-backfill-card.tsx` | `POST /api/workout/backfill-set-hr-stats {maxRows:500}`, looped up to 100 passes | Writes `set_hr_stats` for workouts whose recap was never opened. | last 180 d | Yes, an additive, fuller-wins upsert. Rate limit **6/min** while the client loops up to 100 passes, so a large backlog stops with "HTTP 429" (press again). | admin session | none | **Recurring remedy** (per the inventory): whenever a workout ended without its recap being opened. |
| Backfill per-workout HR summary > **Run backfill** | same component `:59` via `workout-hr-backfill-card.tsx` | `POST /api/oura-ble/backfill-hr-stats` | Writes `workout_hr_stats`. | last 180 d | yes (same as above) | admin session | none | Once after v1.257.2. Afterwards the recap keeps it current. |
| Model asset delivery > **Check model assets** | `model-assets-card.tsx:54` | `GET /api/admin/model-assets` | Reads only: are the ONNX models in object storage? **There is no in-app model upload.** | n/a | yes | admin session | none | After changing model storage, and yearly. |
| Diagnostics > **Error log / AI usage / Day review** | `developer-content.tsx` rows | `GET admin/errors`, `admin/ai-usage`, `admin/day-review` (+ calibration cards `GET admin/sleep-feel-calibration`, `battery-recovery-calibration`) | Reads only. | | yes | admin session (day-review also bearer) | none | |

## 9. `/admin/cadence` and `/admin/data-capture`

| Button | File:line | Calls | What it does | Repeat? | Danger |
|---|---|---|---|---|---|
| Cadence > **Start capture** / **Stop** | `components/cadence/cadence-calibration-console.tsx:266` / `:262` | strap + ring tracker. **Stop also calls native `drainHistory()`** (`:131`). | Treadmill cadence capture. Saved to localStorage. | yes | none |
| Cadence > **Sync ring** | `:305` | native `drainHistory()` | **Duplicate** of Sync now (it only drains when the ring is connected). | yes | none |
| Cadence > **Clear** ("N capture(s) saved on this device") | `:417` | localStorage | **Deletes the device-only saved captures. No confirm.** | n/a | destructive (local only) |
| Data capture > **Run all** / per-probe **Run** / **Copy** | `components/admin/data-capture-console.tsx:142` / `:169` / `:181` | a list of GETs plus native `getStatus` / `hasKey` / `getLog` | Reads only. | yes | none |
| Data capture > **Reset nav timings** | `:139` | local | Clears the navigation-timing samples on this device. | yes | none |

## 10. Owner maintenance outside the admin screens (any user)

| Button | File:line | Calls | What it does | Scope | Repeat? | Auth | Danger |
|---|---|---|---|---|---|---|---|
| More > Data & Sync > **Sync now** | `components/more/data-sync-panel.tsx:73` | clears `LAST_SYNC_KEY`, then `pullDelta(userId, true)`. On web, `clearAllCache()`. | Forced delta pull into the local store. | delta | yes | user session | none |
| … > **Restore from cloud** | `:92` | `restoreFromCloud()` (`?mode=restore`, no 90-day floor) | Rebuilds the local store with full history. | full history | yes (resumable) | user session | slow |
| … > **Export my data** | `:110` | `GET /api/export` (link) | Downloads everything as NDJSON: a `_manifest` line, one `{domain,row}` line per record, then a trailer — `{"_complete":true}` when whole, `{"_error":…}` when the server failed part-way; no trailer means the download was cut off (#2427). | full | yes | user session (rate-limited) | none (but the file contains PII) |

Device pairing **Forget** buttons (`components/settings/{chest-strap,scale,colmi}-pairing.tsx`) are product settings and are out of scope. Only Colmi has a confirm.

## 11. Admin routes with NO button (scripts or curl only)

`POST /api/admin/rederive-baselines` (re-folds the stored personal baselines), `POST /api/admin/rederive-body-battery` (recomputes past `body_battery_daily` under the current model; a day the TN-20 write guard refuses, because the recompute recorded no movement over a day that did, is reported `kept` and stays out of `written` and the deltas, in a dry run too), `POST /api/admin/backfill-derived-scores` (persists Sleep and Readiness scores across history). `POST /api/admin/backfill-set-hrr1` (#2457) re-measures every stored `set_hr_stats` row's `hrr1_bpm` from dense HR and **rewrites `rest_adequate` from it, null included**; dry run unless `dryRun=false`, one transaction that rolls back if the rows written differ from the rows planned, and it needs a verified snapshot first because it overwrites stored verdicts. All four are admin session only, rate-limited, and full history. They are idempotent re-derives, **but each one moves past scores**, which is `type: tuning` territory. Read-only routes: `GET device-comparison`, `GET app-load-report`, and the bearer routes `db-query`, `replay`, `day-review`, `db-snapshot` (`scripts/local-db/snapshot.js`).

---

## Duplicates

1. **Full-history redecode has three buttons:** *Sync & Redecode* (drains first, then a fixed 4 s wait), *History & sync > Redecode*, and *D0 step backfill > Run backfill now* (the same job with `allowStepsDecrease=1`). They share one single-flight job slot. Until issue 2383, `startRedecodeJob` did not compare the opts, so a backfill pressed during a plain Redecode followed that run, the decrease never happened, and the console printed "Done. Backfill applied" (finding F9). **Fixed:** a request may follow a running job only if that job writes everything the request asked for (`canFollowRunningRedecode` in `lib/oura-ble/redecode-job-kind.ts`). A backfill during a plain run is refused with 409; a plain run during a backfill follows it; the poll reports each job's `kind`.
2. **Drain from cursor has five buttons:** *Sync now*, *Drain history* (does not start the service), *Step calibration > Mark start*, *Cadence > Sync ring*, and *Cadence > Stop* (implicit).
3. **One-night dump has two buttons:** *Sleep > Sleep epochs > Compute* and *SleepNet dump > Run dump*. Both call `redecode?date=&dump=1`.
4. **Two buttons both labelled "Run backfill"** on the Developer screen (set-HR and workout-HR). Same component, different routes.
5. **Two buttons labelled "Sync now"** do different things: *More > Data & Sync* is a server-to-local-store pull, and *Oura BLE* is a ring-to-server drain.

## Findings worth an issue

- **F1. Clear key has no confirm** (`oura-ble-debug.tsx:614`). It is the one action that can permanently cut the owner off from the ring, and it is a single tap on a ghost button. Every other destructive control on the page has a `ConfirmDialog`.
- **F2. Users > deactivate has no self-guard and no confirm** (`admin-content.tsx:407`, `api/admin/users` PATCH). DELETE guards against "yourself" and PATCH does not. **Fixed in #2383 item 3:** PATCH deactivate refuses self, the own row has no deactivate icon, and deactivating anyone else asks first.
- **F3. Fix lbs logged as kg > Apply is not idempotent.** A second apply over the same exercises and date converts twice.
- **F4. The `dumpOnly` path is described as "writes nothing"** (route comment, `run.ts:1270`) and the SleepNet card says it "does not change the staging stored". Per the code, it runs the windowed rollup steps including writes, and skips only the watermark. That is harmless in practice because it is deterministic, but the description is wrong. Related: `dumpOnly` leaves `fullHistory` false, so the read window is narrowed by the rollup watermark (`run.ts:97–112`), to roughly the last few days rather than the 35 days the comment promises. A dump for an older night may answer "no BLE night" for that reason (suspected, not reproduced).
- **F5. Feedback "Confirm delete" ignores the response.** The row disappears from the UI even when the DELETE failed.
- **F6. HR backfill client loop against the 6/min rate limit.** A backlog of more than 3,000 sessions ends in "HTTP 429" partway through. It is re-runnable, so this is low severity.
- **F7. Pack sealed frames versus the rule "never prune or mutate the server raw archive".** It is proof-gated and confirm-gated, but it is still a delete. The owner should consciously sign off that Lever 5 is an exception to the rule.
- **F9. A step backfill can silently no-op.** *Run backfill now* reported success after attaching to an already-running plain redecode, because the job slot ignored `allowStepsDecrease`. **Fixed for issue 2383:** the backfill is refused with 409 while a plain redecode runs (never queued), and the console claims "Backfill applied" only for a finished job whose kind is `step-backfill`.
- **F8. Hard deletes without a tombstone:** exercise library delete, pending-user delete, feedback delete. The offline-first rule asks for `deleted_at`. The exercise library is the case that matters for unsynced devices.

---

## (a) What an agent could safely run with a narrowly scoped token, and what stays owner-only

**Candidates for an agent token (idempotent, additive or re-derive, no ring, no deletes).** None of
these accepts a bearer today, so every one would need a new, narrowly scoped token: today's bearers
are read-only by design.

- `POST /api/workout/backfill-set-hr-stats` and `POST /api/oura-ble/backfill-hr-stats`. They are additive fuller-wins upserts and mutate no source data. They are the best first candidates, because the set-HR one is a recurring remedy.
- `POST /api/oura-ble/samples/redecode?async=1` (plain full-history redecode, **without** `allowStepsDecrease`) plus its `GET ?jobId=` poll. It is idempotent and single-flight, but slow, and it was once an outage. Limit it to one run per release with the rate limit as is. The agent should run it after a release that changes a decoder, the stager or a rollup step.
- `POST /api/admin/vacuum` on the allowlist. It is idempotent and loses no data, but it locks ingest briefly, so run it off-peak. It is borderline: allow it only on `error_events`, or after a Pack the owner already approved.
- Every read: summary, raw, db-stats, model-assets, time-audit, comparison and probe GETs, step-backfill-preview, fix-exercise-units preview, and the existing bearer read routes.
- **With owner sign-off per run (they move past scores, so they count as tuning):** `rederive-baselines`, `rederive-body-battery`, `backfill-derived-scores`. They are technically idempotent re-derives, but CLAUDE.md puts scoring changes behind the owner.

**Must stay owner-only:**

- Everything **native or ring-touching**: Save key, Show/Copy key, **Clear key**, Full re-sync, every feature-mode lever (Measure OFF, Steps OFF, the HR modes), SyncTime, Accel and Live HR, battery soak, continuous capture. An agent has no APK anyway, and the key operations are irreversible.
- **Declare a re-key**. Not idempotent, and it re-times history once consumed.
- **D0 step backfill (Run backfill now)**, **Fix lbs logged as kg > Apply**, and **Null historical decoded**: one-way rewrites.
- **Pack sealed frames**: deletes archival rows.
- Users activate, deactivate and delete; invites; feedback delete; exercise and activity delete. These touch auth or delete data, which CLAUDE.md makes confirm-first.
- **AI all** and per-row regenerate: they spend money.
- Reference-figure upload: a global content change.

## (b) Labels that do not say what the button does

| Label | What it actually does |
|---|---|
| **Redecode** | A full-history re-decode **and re-aggregate of every derived table**, which takes minutes. Nothing in the label says "all history". |
| **Sync & Redecode** | Drain, a fixed 4 s wait, then a full-history redecode. The 4 s wait is invisible. |
| **Drain history** versus **Sync now** | The same drain. The only difference is that Sync now starts the service first. |
| **Clear key** | Deletes the ring's only credential. It reads like "clear a form field". |
| **Measure OFF** | Turns off daytime HR, SpO₂ **and** steps on the ring. |
| **Compute** (Sleep epochs) / **Run dump** (SleepNet) | Both re-run the recent-window rollup on the server. Neither is a pure read. |
| **Run backfill** (×2) | Two different tables (per-set versus per-workout HR), with the same label. |
| **Battery** / **Info** / **SyncTime** under "Cardio · Body-comp" | These are ring connection reads and a clock set. They are filed under the wrong domain. |
| **Mark start** | Also drains the ring. |
| Cadence **Stop** | Also drains the ring. |
| **Null historical decoded (Lever 1b)**, **Pack sealed frames (Lever 5)**, **VACUUM FULL (Lever 1c)** | They lean on internal "Lever N" names. The confirm dialogs explain; the buttons do not. |
| **AI all** | One paid AI generation per uncovered exercise, with no count or cost before the press. |
| Icon-only controls: user activate/deactivate (UserCheck/UserX; `aria-label` since #2383), user delete, invite remove, exercise row icons, activity **trash** (no aria-label) | No text label. The activity delete has no accessible name at all. |
| **Sync now** (More > Data & Sync) | A server-to-device pull. It shares its name with the Oura BLE ring drain. |
| **Export my data** | Fine, but it downloads PII without a warning. |

## Not exercised

Everything here is from reading code. Nothing was run on `pnpm dev` or on the device. Native plugin
behaviour (`clearKey`, `drainHistory`, feature modes), real device tokens and production data were
not touched. These are inferred from code and not reproduced: F4 (that `dumpOnly` writes, and how
narrow its window is), F2 (whether a deactivated admin is actually locked out), and the observed effect of F9 (it was
confirmed in code only).
