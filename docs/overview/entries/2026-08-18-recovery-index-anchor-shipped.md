## 2026-08-18 — Recovery Index anchor shipped, and a wrong claim of mine corrected (Tuning, v1.320.0)

The owner delegated every open decision (*"we will go with whatever your recommendation is, knowing
we are going for best practice + future proof"*). Three outcomes: one shipped, one **reverted after
being implemented**, and three design decisions resolved.

**Shipped — Q-500.** `RECOVERY_INDEX_OPTIMAL_HOURS` 6 → 5, fitted against Oura's own
`recovery_index` contributor over the 15 pre-re-key nights where both exist. Our estimator tracks
theirs at **r = +0.712** but carried a systematic **−10.2-point** bias; the zero-bias anchor is
**4.63 h** (LOO 4.40–5.14, RMSE flat 4.5–5.25), and **5** sits on that floor while keeping a small
negative bias. `READINESS_MODEL_VERSION` → `v3:ri5:2026-08-18`.

**Thresholds deliberately NOT re-anchored — a nuance in my own rule.** `LOW_SLEEP_SCORE` moved with
the sleep recalibration because the *scale* changed and firing rates had to be preserved. Q-500 is a
**bias correction on one contributor**, not a scale change: the 3 days that go 74 → 75 become
"recovered" because the measurement was under-reporting, which is the fix working rather than a
side-effect to cancel. No day crosses the early-deload, Low/Moderate or low-readiness line.

**Reverted — the zone HRmax "fix".** I had shipped a claim in the Activity plan that
`daily_zone_minutes` using `max_hr = 187` while Body Battery uses the measured 168 was a
One-Formula-One-Place violation. **It is not.** `resolveHrProfile` is already canonical and
deliberately returns `maxHr` (the ceiling) *and* `targetAnchorMax` (the reachable-target anchor),
with `resolveBatteryHrMax` a third for the battery reserve; its own comment explains why the ceiling
must not be the observed max (*"every hard effort read as >100%"*). The change was implemented, then
reverted on reading that, and the plan and Q-505 are corrected.

**What survives that correction, measured:** at the 187 ceiling zone 2 starts ~133 bpm, and over
**52,647** HR samples since 2026-07-07 only **134 (0.25%)** reach it — observed max 166. So zone 2+
really is ~1 min/day for this training style. The reading is honest; the lane still needs a ceiling
decision before it carries weight.

**Three Activity decisions resolved** (in the plan, with reasoning): over-exertion is **fitted**
against next-day HRV/RHR rather than invented — small weight plus a written admission if there is no
correlation; bands go **target-relative** with Activity getting its own band function so the shared
`scoreBand()` stays absolute for Sleep and Readiness; and the zone lane scores against
**`targetAnchorMax`**, which resolves the ceiling-vs-observed trade rather than splitting it and adds
no fourth concept.

**Verification.** Full suite **3,352 passed**; `check:rules` 38/38; typecheck clean. One test fixture
updated with its reason (the recovery-index curve's midpoint is anchor-dependent: 3 h → 2.5 h; the
property under test — linear, true 100 at the optimum, clamped, provisional — is unchanged).

**A near-miss worth recording:** the first backlog edit spliced by line range and **silently deleted
the whole Q-505 entry**. Caught by re-grepping the headings afterwards. Replace a bounded block by
its own next heading, not by the next entry you happen to remember.

**Not exercised.** Nothing on-device. The Cloud-era fit is not re-derived on BLE nights (BLE HR is
~2× noisier, so the anchor is conservative rather than wrong) — re-measure once ~15 exist.
