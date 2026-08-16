# Body — domain index

**Owns:** body weight, body composition (fat/muscle/water and their derivations), and weigh-in
handling — which day a reading is filed under, and reconciling manual entries against scale
readings.

**Does not own:** the Renpho scale radio and its BLE session ([`devices`](../devices/README.md)).
This is the smallest pillar; it exists separately because weight and composition feed several
others (energy balance, bodyweight 1RM, readiness) and shouldn't be buried inside any one of them.

## Code

| Area | Where |
|---|---|
| Composition maths | `lib/health/body-composition.ts` |
| Scale capture (border with `devices`) | `lib/scale-ble/` |
| Ingest clock | `lib/validation/ingest-clock.ts` — `resolveMeasuredAt` decides the day a weigh-in belongs to |
| Tables | `body_metrics` (weight, body fat, and the rest of the daily metric row) |

## Reference docs

- [`docs/reviews/2026-08-15-pillar-model-soundness-review.md`](../../reviews/2026-08-15-pillar-model-soundness-review.md)
  — §5: reviewed and **came back clean**. The 17-vs-68 composition-column gap is benign (those
  columns first appear 2026-07-29); the six tape-measure columns at 0 of 108 are *correctly empty*.
  No entries filed.
- [`docs/handoff-2026-07-29-ingest-and-records.md`](../../handoff-2026-07-29-ingest-and-records.md)
  — §Q-25 covers the weigh-in-filed-on-the-wrong-day fault and the clock-resolution fix.
- [`docs/reviews/2026-08-03-cross-domain-bug-review.md`](../../reviews/2026-08-03-cross-domain-bug-review.md)
  — Q-56 (open, investigation-first, shared with `devices`/`sleep`): real `body_metrics` rows landed
  dated up to 5 days in the future in production; one is still live and wrong as of 2026-08-03.
- Plans: `ls docs/superpowers/plans/*body*` / `*scale*`.

- Reviews: [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — **full-app deep review, 2026-08-07** (saving/caching/performance/logic across all 201 routes and 40 pages; 53 findings queued as Q-117…Q-138, plus root cause for Q-73 and mechanisms for Q-72/Q-107)

## Open issues

```bash
grep -n '^### .*\[body\]' projectOverview.md   # 2 entries today
grep -n '\[body\]' docs/implementation-backlog.md   # Q-56 today
```

- 🔴 **Q-56 — future-dated `body_metrics` rows** (2026-08-03, open). See the review link above.
- ~~"Burned"/"Balance" cards read a broken, HC-only calorie source~~ **fixed 2026-08-05 (Q-96,
  v1.266.4)** — both now read `activeEnergyKcalToday` (`computeActiveEnergy()`), the same source
  already correctly feeding `EnergyBudgetCard`. See
  [`entries/2026-08-05-body-burned-balance-energy-source.md`](../../overview/entries/2026-08-05-body-burned-balance-energy-source.md).

Live at the time of writing (2026-07-30):

- **Scale passive-scan background sync** — the retry-storm fix was **confirmed on-device**
  2026-07-30 (v1.242.0); `ScaleBleService` moved from a continuous 45 s poll to a
  `BluetoothLeScanner` PendingIntent scan. Shared with `devices`.
- The direct-BLE Renpho scale integration itself is device-verified (2026-07-28) — shared with
  `devices`.

The scale-sync and Renpho entries above are shipped and device-confirmed; Q-56 (above) is the one
open item. Re-run the greps rather than trusting this list.

## History

- Handoffs: `ls docs/handoff-*-body-*.md` — plus
  [`docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md`](../../handoff-2026-08-03-cross-owner-bug-batch-triage.md)
  (Q-69 — scale weight trend should use the day's lowest confirmed reading, not the first), filed
  under `cross` because it spans five pillars.
- Journal: `grep -rl 'weigh\|body.composition\|scale' docs/overview/entries/`

## Gotchas specific to this domain

- **A weigh-in's timestamp is not necessarily its day.** Route it through `resolveMeasuredAt`; a
  raw client timestamp filed a reading on the wrong day.
- **Bodyweight changes propagate.** Weight feeds bodyweight-1RM history, energy balance and
  readiness — a correction here can shift derived values elsewhere, which is exactly how the
  phantom Pull-Up PR happened.
- **Oura data must never overwrite manual or Health Connect values** — all upserts into
  `body_metrics` use `COALESCE(EXCLUDED.col, table.col)`.
