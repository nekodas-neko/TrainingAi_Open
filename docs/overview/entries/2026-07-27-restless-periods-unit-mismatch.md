## 2026-07-27 — `restless_periods` was two different quantities in one column (v1.223.0, audit finding Q-3)

### The defect

`sleep_sessions.restless_periods` holds Oura's own restlessness measure on Cloud-era nights and
`model.awakenings` on BLE nights. Those are different quantities — a count of movement periods versus
a count of wake events — and one curve was applied to both.

`RESTLESS_PENALTY` topped out at **50**. Measured over the whole production history:

| era | nights | stored value | penalty applied | mean restfulness |
|---|---|---|---|---|
| Cloud | 15 | **138–330** | **32.0 — the maximum, every single night** | 48.6 |
| BLE | 20 | **0–5** | 0–2.5 | 86.3 |

Every Cloud value exceeded the curve's last anchor, so `interp` clamped and each night took the full
penalty regardless of how restless it actually was. Every BLE value sat in the curve's flattest
region, so the term did essentially nothing. The 37.7-point restfulness gap between the eras is
**entirely units**, and it depressed every pre-cutover Sleep Score by ~2.6 points (restfulness is 9
of 110 weight).

The live day-review confirms the cliff — restfulness reads **37–57 on Cloud nights and 58–98 on BLE
ones**, with the step falling exactly at the 2026-07-07 re-key.

### What shipped

**The term is dropped, not re-scaled.** There is no honest conversion between the two quantities, so
inventing one would have replaced a visible bug with an invisible one. `efficiency` and the awake
fraction — both unit-stable across the cutover — remain, and they already carry the restfulness
signal. On the BLE side the removed term was worth ≤2.5 points, so nothing measurable is lost.

`RESTLESS_PENALTY` is deleted along with its `SLEEP_MODEL` entry, and the audit's restfulness
contributor now shows the awake fraction as its scored input while still displaying the raw
`restless_periods` value and explaining why it isn't scored.

**Effect:** Cloud nights gain 32.0 restfulness (~+2.6 score); BLE nights gain 1.2 (~+0.1). The two
eras become comparable for the first time.

### A useful discovery

**The era is already recorded per-field.** `sleep_sessions.source_map` carries
`{"restless_periods": "oura_ble", …}` on BLE rows and is NULL on Cloud rows. So no new column and no
date-based era guessing was needed to establish which scale a row is on — which is what makes the
follow-up (a calibrated awakenings penalty) tractable.

### Verification

Full CI-equivalent suite green, typecheck, lint and both custom-rule checks clean.

The old test asserted exactly the behaviour being removed (`lowers restfulness as restlessness
rises`) — it was replaced, not deleted quietly. Three tests now pin the new contract: restfulness is
identical whether `restlessPeriods` is null, 5 (BLE scale) or 330 (Cloud scale), and it still falls
as time-awake rises and as efficiency drops.

**Not exercised — on-device.** Pure scoring change, no native path, but the sleep-detail contributor
chart has not been seen on the S25.

### Deliberately not done

- **An awakenings-calibrated penalty.** Choosing penalty magnitudes is a tuning decision with no
  ground truth; the Q-16 calibration card is the tool for it. Filed as **Q-3b(a)**.
- **The chronic-stress consumer.** `chronic-stress-assembly.ts` feeds the same column to `gotUps`, a
  ported Oura model expecting Oura's scale. Worth knowing before prioritising it:
  `oura_daily_derived.chronic_stress_score` is populated on **0 of 70 rows** — the model has never
  produced a value in production. Fixing it properly needs provenance on `oura_daily_summary`, which
  has no source column. Filed as **Q-3b(b)**.

### Consequence worth knowing

Historical Sleep Scores change meaning again: every Cloud-era night now scores ~2.6 higher than when
it was displayed. F-2's backfill (shipped earlier today) is what puts the persisted rows back onto
the current model — it has still not been run against production.
