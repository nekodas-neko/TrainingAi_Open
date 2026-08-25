# 2026-08-25 — the ring's power budget: the whole investigation (Q-388)

**Extracted from `docs/implementation-backlog.md` on 2026-08-25**, per the compaction chore recorded
in [`docs/doc-size-baseline-history.md`](../doc-size-baseline-history.md). Q-388 stays in the queue
as a decision plus a pointer here; nothing below is lost, and nothing below is startable work.

**The state, in one line:** items 2 and 3 shipped, the night-window question was measured and
answered (SpO₂ is already 98.9% night-gated by firmware, so gating it in our code is a no-op), and
what remains is a binary owner decision on whether SpO₂ stays on at all.

---

### [devices][heart-rate] Q-388 — the ring runs SpO₂ and daytime-HR recording permanently, nobody chose it, and it is ~3.5× stock drain

- **Lane:** A
- **Gate:** owner — added 2026-08-25. Not a new judgement: this entry's own text already says
  *"What still remains here is the SpO₂ decision itself (item 1) and the cadence knobs (item 4),
  both owner-gated"*, and items 2 and 3 are done. The field just makes that machine-readable, so
  `next-item.js` stops offering it as startable work.
- **✅ Item (2) shipped 2026-08-23** in `feat/ring-service-device-pass` (native — **needs an APK**):
  `enableMeasurementSequence()` now ends with `EXERCISE_HR → AUTOMATIC` and `reqBleFastHrMode(false)`,
  so the fast-HR trap closes on every connect. Recorded as **R8** in
  [`docs/oura-ble-operations.md`](../oura-ble-operations.md) §1.
- **⚠ Item (3) was already done before this entry was written, and the entry's central claim is
  therefore false.** *"the keepalive already polls it every 5 min and `parseBattery` decodes it,
  but it is never stored, so drain cannot be measured at all today"* — it **is** stored:
  `OuraRingService.postBatteryPoll` fires on every keepalive tick into
  `POST /api/oura-ble/battery-poll` → `oura_ble_battery_poll` (migration 133). Production holds
  **6,346 polls from 2026-07-19 onward**, still arriving. So the evidence this entry says is
  missing has existed the whole time, and **the A/B in (b) is runnable now** rather than blocked on
  a native change.
- **The drain is measured, not argued (2026-08-23).** Overnight, 22:00→08:00 Brisbane, nights with
  no charging in the window: **−22, −24, −22, −38, −15 percentage points** over ~9.8 h. That
  confirms the owner's ~20%/night report with the ring's own telemetry, and it means an SpO₂ A/B
  needs only two nights of wear and this same query — no code, no APK.
- **What still remains here** is the SpO₂ decision itself (item 1) and the cadence knobs (item 4),
  both owner-gated. The batch no longer holds anything for this entry.
- **2026-08-24 — owner asked whether gating SpO₂ + temp to a night-only window would help, and for
  real numbers. It would not touch SpO₂, and would touch temp only marginally — this is a genuinely
  new fix direction from items 1–4 above, and it is now resolved rather than open.** Full 24-hour
  breakdown, owner's rows, 7 days (`claude_ro.oura_raw_samples`, `measured_at` bucketed to
  Australia/Brisbane):

  ```
  hr   temp  spo2  green   ibi        hr   temp  spo2  green   ibi
  00    571  5704     52  3874        12    469     0    719   287
  01    429  4859      0  3236        13    390     0    815    40
  02    551  5115      0  3288        14    385     0    866   289
  03    439  3826      0  2411        15    454     0   1025   148
  04    482  4715    392  3179        16    484    43   1305    79
  05    854  9532    101  6098        17    476     0   1331   450
  06    597  5885    308  4146        18    376   292    956   620
  07    590  4179    586  3088        19    297    21    745    15
  08    410  1173    639  1154        20    497     0   1616   317
  09    465   144   1103   737        21    373     0    927   425
  10    431    56   1436   153        22    462  1535    801  1406
  11    351     0    670    47        23    450  3121    696  2291
  ```

  **SpO₂ (`spo2_r_pi_event`, tag 139) is 98.9% inside 22:00–09:00 already** (49,644 of 50,200/week) —
  the ring's own AUTOMATIC-mode firmware already gates it to sleep, not the app. A night-only window
  in our code would be a no-op restating what the firmware already does; it buys nothing beyond
  item 1 (turn the feature off) and does not substitute for it. The real remaining lever for SpO₂ is
  its *density* inside that window — hour 5 alone averaged ~23 events/min across the 7 nights — which
  is the cadence question item 4 already names as unresolved, and item 4's own text is explicit that
  the *radio*-side knobs it lists (`DRAIN_INTERVAL_MS`, connection priority) cannot touch a PPG/SpO₂
  sensor duty cycle — no code in this repo currently exposes a sensor-side density control, so this
  stays a fix direction, not a number.
  **Temp (`temp_event`/`temp_period`, tags 70/105, DAYTIME_HR-bundled per `OuraProtocol.kt:114-122`)
  is flat across all 24 hours — no night concentration to find.** It is also small: 10,171 of the
  week's 166,233 raw events (6.1%), against SpO₂'s 30.2% and `ibi_and_amplitude`'s 22.7%. And per
  `lib/oura-ble/rollup/run.ts:503-513`, the daytime stream (0x46/0x69) is **already dropped** from
  the readiness temperature-deviation score — a documented quantisation defect (98.3% of 30k rows sit
  on an exact 0.5°C grid) leaves it "no discriminative power," so only `sleep_temp_event` (tag 117,
  1,112/week, fires only while asleep by the ring's own logic) feeds the score. The daytime stream's
  one remaining consumer is `markWorn()` (`run.ts:865-867`, a coarse ≥31°C wear heuristic) — cutting
  it to night-only would save at most ~3% of total event volume (half of 6.1%) and costs the daytime
  half of that wear signal, which the other six event types feeding `markWorn` may or may not cover
  as well; untested. **Not worth a PR on its own.**
- **What this changes for items 1 and 4:** SpO₂ is confirmed the dominant, already-night-concentrated
  cost — the open decision is still binary off-by-default (item 1) plus, if kept on, a real sensor
  density/duty-cycle control that does not exist in the protocol layer today (item 4, now known to
  need new ground rather than a config tweak). Temp is not a meaningful lever either way and needs no
  further owner decision. Event counts are a volume proxy (each event costs one BLE frame + one flash
  write + one decode), not measured mAh — no code changed by this note.
- **⚑ This is the same investigation as Q-116, filed 11 days earlier, and neither entry knew.**
  Q-116 (2026-08-06) reports a live HR reading on the Health tab with nobody having tapped
  *Measure now*, and suspects it explains ~15%/night of drain; this entry (2026-08-17) reports
  ~20% overnight. **The "separate latent defect" traced above is Q-116's own leak vector**: a
  live-HR session that never reaches `stopLiveHr()` leaves fast-HR sampling on permanently, healed
  by no reconnect or restart. Item (2) closes that vector outright, and item (3) is the
  observability Q-116 needs before its ~15% claim can be tested at all.

- **Branch:** `fix/ring-measurement-power-budget`
- **Added:** 2026-08-17 · owner: *"the battery life drains too fast. Stock it lasts 7 days; but with
  our build it loses about 20% over night I'm seeing. Well too much. It requires a long charge every
  2 days. Needs to be reviewed to see whats chewing so much of its battery."*
- **The arithmetic:** stock 7 days ≈ 14%/day. A charge every 2 days ≈ 50%/day, with 20% of that
  overnight alone. Roughly **3.5× stock drain**.

**What we turn on, and where.** `OuraRingService.onReady()` runs
`OuraProtocol.enableMeasurementSequence()` on **every connect**
(`android/app/src/main/java/com/trainingai/app/oura/OuraProtocol.kt:123-127`):

```kotlin
reqSetFeatureMode(FeatureId.DAYTIME_HR, FeatureMode.AUTOMATIC),
reqSetFeatureMode(FeatureId.SPO2,       FeatureMode.AUTOMATIC),
reqSetFeatureMode(FeatureId.REAL_STEPS, FeatureMode.AUTOMATIC),
```

Unconditional, idempotent, **no user toggle anywhere in the app**, and re-asserted on every
reconnect so the ring can never drift back. On stock Oura, blood-oxygen sensing is an opt-in the
vendor itself warns costs battery life. We enable it for everyone, permanently, and the only
in-repo note on its cost is the REAL_STEPS comment observing that steps are *"passive (no sensor
power cost, unlike the DHR burst)"* — so the DHR burst's cost was known and never budgeted.

**Measured against production** (`claude_ro.oura_raw_samples`, 7 days, owner's rows only — this view
is row-scoped to one user and prunes at 30 days, so these are the owner's counts, recently):

```
tag  event_name                rows(7d)
139  spo2_r_pi_event             53,412   <- largest single source
 96  ibi_and_amplitude_event     40,898
128  green_ibi_quality_event     14,098
115  ehr_trace_event              3,859
```

**SpO₂ is both the biggest source and concentrated exactly where the owner sees the loss** — events
by hour, Brisbane:

```
hour   00    03    05    08    11    14    16    20    23
spo2 5942  4946  7319  1465     0    11  2149    54  5216
green  45   125     0   587   706   750  1174  1126  1068
ehr     0     0     0     0   648   208   128   556     0
```

~75% of SpO₂ events fall between 22:00 and 09:00 — the overnight window the owner reports losing
20% in. Green-PPG (DAYTIME_HR) carries a steady daytime load on top.

- **A step change on 2026-08-04 that nothing explains — resolve this first.** Daily totals go
  5,378 → 23,874 and hold (SpO₂ 586 → ~8,000/day). **Open question, not a cause:** this counts
  *ingested* events, so better draining looks identical to more sensing. SPO2 has been in
  `enableMeasurementSequence` since 2026-07-07 (#320, v1.117.2), and
  `docs/overview/history-2026-08-04.md` shows no ring-side change that would account for it. It
  decides whether the fix is "sense less" or "we always sensed this much and only now noticed".
- **A separate latent defect, found while tracing — NOT today's cause.** `reqBleFastHrMode(false)`
  and `EXERCISE_HR → AUTOMATIC` appear **only** in `liveHrStopSequence()` (`OuraProtocol.kt:256-259`);
  the connect-time sequence resets DAYTIME_HR, SPO2 and REAL_STEPS but **neither of these**. Any
  live-HR session that never reaches `stopLiveHr()` — app killed mid-workout, Samsung battery
  management killing the service (failure L9 in
  [`docs/oura-ble-operations.md`](../oura-ble-operations.md)), or the `/admin/oura-ble` tester's
  **Live HR** button without **Stop HR** — leaves continuous fast-HR sampling on **permanently**,
  healed by no reconnect, app restart or service restart. Production says it is not firing now
  (`ehr_trace_event` is zero 21:00–08:00), so it is a trap waiting, not the current drain. Fix
  regardless: add both resets to the connect-time sequence, the one path guaranteed to run.
- **Evidence that would settle it:** (a) ~~persist the ring's battery telemetry~~ — **done since
  2026-07-19**, see the correction above; (b) A/B two nights, SPO2 `OFF` vs unchanged, same wear
  pattern, compare overnight % — that prices the feature directly, **and (a) means this is now a
  wear-pattern question rather than an engineering one**;
  (c) confirm whether the owner had blood-oxygen sensing enabled in the stock Oura app before the
  re-key. If it was off there and on here, that alone is most of the gap.
- **Fix directions (undecided — measurement first):** (1) make SpO₂ a user setting defaulting off,
  rather than an unconditional connect-time write; (2) reset EXERCISE_HR and fast-HR mode in
  `enableMeasurementSequence()` — cheap, independent of the measurement, do it regardless;
  (3) persist the battery poll so this is observable rather than argued; (4) *only then* the cadence
  knobs ([`docs/oura-ble-operations.md`](../oura-ble-operations.md) §2: raise `DRAIN_INTERVAL_MS`, drop
  idle priority to `CONNECTION_PRIORITY_LOW_POWER`) — **these are radio-side, not sensor-side**, so
  they cannot touch a PPG/SpO₂ duty cycle and are the wrong lever if sensing is the cause. That
  doc's rule against touching the 5-min keepalive still stands: it is the drop detector.
- **What would count as fixed:** overnight drop back near stock (~14%/day), proven by (a) rather
  than a subjective "feels better", and nothing power-hungry enabled that the owner did not choose.
- **Surface: device required for a fix, not for the measurement.** The sandbox cannot run BLE and
  Kotlin only compile-checks in Android CI, so any *change* needs an APK and a wear cycle. But the
  power draw **is** recorded and readable from here — the line above that said otherwise was wrong
  for a month.
