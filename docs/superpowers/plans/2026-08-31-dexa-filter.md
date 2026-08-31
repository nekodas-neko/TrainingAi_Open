# BF-2 — the DEXA filter: correcting the scale's body fat at read time

**Written:** 2026-08-31 · **Lane A** (engine) with a **Lane B** display half · **Status:** plan only,
nothing implemented.

> Owner, 2026-08-23: *"I'd like to be able to upload a dexa scan/RMR values; and 1- have a filter
> that aligns our scales values to a dexa scan; will call it 'dexa filter' so if our scale says 15%
> BF but dexa says 20% we will keep that ratio in mind when giving values; as well as fixing previous
> values."*
> Owner, 2026-08-27: *"first we need that Dexa scan filter applied so it shows Body fat on the
> current scale as per a dexa result."*

---

## 1. What was re-verified before writing this, and what had moved

Everything below was measured against current `main` and **production** on 2026-08-31, not taken
from the entry.

| Claim in the BF-2 entry | Status |
|---|---|
| `dexa_scans` + `dexa_scan_regions` exist (migration 240), with `GET`/`POST /api/dexa-scans` | ✅ true |
| The RMR half is split out as BF-33 and needs no calibration maths | ✅ **shipped** — `measured_rmr` (225/226), `personalRmr`, `/api/measured-rmr` |
| The calibration pair exists: DEXA 28.5 % vs same-day Renpho 25.3 % | ✅ the **scale** half is in production — 2026-08-27, 71.7 kg, 25.3 %, `source_map->>'body_fat_pct' = 'scale_ble'` |
| The scale is consistent (the premise the design rests on) | ✅ twelve consecutive `scale_ble` days sit in **24.9–25.5 %** |
| …and the DEXA half is stored | ❌ **`dexa_scans` holds zero of the owner's rows** |

**The finding that changes the shape of this work: there is no way to enter a DEXA scan.**
`grep -rn "dexa-scans\|measured-rmr" app/ components/ lib/` outside `app/api/` returns **nothing** —
no screen, no form, no client fetch. BF-41 shipped the table and the routes; BF-33 shipped
`measured_rmr` and its route. **Both tables are empty in production and neither can be filled from
the app.** The 2026-08-27 printout is transcribed in
[`clinical-baseline-2026-08-27.md`](../../clinical-baseline-2026-08-27.md) and has been sitting there
for four days with nowhere to go.

That is filed separately as **LA-44** and is a *precondition for observing* this work, not for
building it: the correction engine is safely inert with zero pairs (a source with no pairs reads
uncorrected), so it can ship first and start working the moment a scan is entered.

---

## 2. The decisions, made here so they are not made by accident

### 2.1 Correct at read time. Never re-stamp `body_metrics`.

The entry offered (a) read-time correction and (b) a corrective migration, and recommended (a). Take
it, and the empty-table finding above makes the case stronger rather than weaker: with the raw
readings archival, entering the scan four days or four months late retroactively corrects **all**
history with no migration and no data loss, and a second DEXA that disagrees just re-derives.
This mirrors the `oura_raw_samples.body_hex` rule — the raw capture is the archive, the derived value
is recomputed.

### 2.2 Derive the pairs; do not store them. *This reverses the entry's assumption.*

The entry says the stored thing is "a set of paired (scan, scale) observations". **A stored pair is a
stored counter wearing a different hat**, and CLAUDE.md's rule on those is unambiguous — every one in
this project has drifted. Both halves are already first-class rows:

- the scan half is `dexa_scans` (`scanned_on`, `pct_fat`),
- the scale half is `body_metrics` (`date`, `body_fat_pct`, `source_map->>'body_fat_pct'`).

The join key is the date and the instrument key is already in `source_map`. Storing the pair would
duplicate both and drift the moment either side is edited — a re-extracted scan, a re-synced scale
row — and it would need an entry step that a derived pair does not: **a second DEXA becomes a second
pair automatically.**

**No new table. No new migration.** That is the single biggest simplification in this plan, and it
is why this entry no longer needs a migration number.

**The one thing derivation must handle** is a scan date with no scale reading. Take the nearest
`scale_ble` reading within **±3 days** and record which date was used, so the pairing is inspectable
rather than magic. Outside that window there is no pair — the scan is still stored, it just does not
calibrate anything. (The owner's own instruction on the day was to weigh in "as close in time to the
scan as practical", so the same-day case is the expected one; the window exists so a missed morning
does not throw the scan away.)

### 2.3 Offset, not ratio — and say out loud that one pair cannot settle it.

With one pair the two forms are numerically identical, so this is a choice about how the correction
**degrades as the body changes**, which is what the entry asked the plan to answer.

- **Offset** (`corrected = raw + 3.2`) holds the measured gap constant.
- **Ratio** (`corrected = raw × 1.1265`) scales it with the reading — at a scale reading of 5 % it
  implies a gap of 0.6 points, i.e. that the scale is nearly correct at low body fat.

**One pair supports neither claim, so prefer the one that does not manufacture a claim.** A ratio
asserts something specific about the bias at readings we have never observed; an offset asserts only
what was measured. Ship the offset, keep the pairs derivable, and revisit at n = 2 — that decision is
its own follow-up, not a placeholder in this code.

### 2.3b The correction reaches a third of the history, and leaves a visible step. Say so.

Measured in production 2026-08-31 — the three instruments are **contiguous, near-disjoint date
ranges**, not interleaved:

| `source_map->>'body_fat_pct'` | Range | Rows | Mean BF |
|---|---|---|---|
| `null` (no provenance recorded) | 2026-05-07 → 2026-06-23 | 40 | 23.50 % |
| `health_connect` | 2026-06-24 → 2026-08-01 | 11 | 22.82 % |
| `scale_ble` | 2026-07-29 → 2026-08-31 | **31** | 24.43 % |

So "fixing previous values" corrects **31 of 82 rows** — the last month — and leaves the earlier
two-thirds untouched. At the measured 3.2-point offset that puts a **visible step in any body-fat
chart at 2026-07-29**, which will read as a real change in the body rather than a change in the
correction.

**Do not close the step by widening the correction.** The 40 provenance-less rows predate
`source_map` being populated and are *probably* the same scale — but "probably" is how a calibration
gets applied to an instrument it was not measured on, which is precisely what the owner's own
refinement (2) rules out. `health_connect` is definitely a different instrument.

**Close it by labelling instead.** The correction result already knows the source, so every corrected
reading carries `corrected: true` and every other one carries `false`; the chart marks where the
calibrated span begins. A step the user can see the reason for is a fact; an unexplained one is a bug
report.

### 2.4 Correct body fat only. Do not correct the rest of the BIA panel.

Trap 1 in the entry: `muscle_mass_kg`, `bone_mass_kg`, `body_water_pct`, `visceral_fat_index`,
`subcutaneous_fat_pct`, `protein_pct` and `metabolic_age` come out of the same
`computeBodyComposition()` call.

- **Fat mass and fat-free mass need no separate correction** — `bodyComposition()` derives both from
  weight and body-fat %, so correcting the input corrects them for free. This is the whole reason the
  insertion point is the *input*, not the consumers.
- **The other columns get no correction, because no pair exists for them.** The DEXA reports lean and
  lean+BMC (49.53 kg / 51.46 kg), which is fat-free mass — it is **not** Renpho's "muscle mass", which
  excludes bone and partitions water differently. Deriving a muscle-mass correction from an FFM
  measurement would be inventing a calibration nobody took.
- **So the panel is internally inconsistent by construction, and the UI must say so** rather than
  quietly showing a corrected fat % beside an uncorrected muscle mass. That labelling is the Lane B
  half (§4).

### 2.5 No new `HEALTH_SOURCES` rank, and this retires a warning in the entry.

The entry warns that adding a DEXA source means editing `lib/data/health-source.ts` **and** the
inlined SQL `CASE` at line 45, together or the ladders diverge. **Under read-time correction that
edit is not needed at all** — the DEXA never writes to `body_metrics`; it lives in `dexa_scans` and
is read alongside.

Writing the DEXA's own body fat into `body_metrics` for the scan date is a defensible separate idea
(it *is* the best measurement for that one day) and it is deliberately **out of scope**: it needs the
source rank, it changes what "the scale said" means on that date, and it would make the calibration
pair partly self-referential. File it if it is ever wanted; do not fold it in here.

---

## 3. Build order — Lane A

Each step is independently mergeable and independently testable.

### Step 1 — the calibration itself, as a pure function

`packages/shared/src/health/body-fat-calibration.ts` (new):

```ts
export interface CalibrationPair {
  scannedOn: string        // the DEXA date
  scaleDate: string        // which reading was paired, so the pairing is inspectable
  referencePct: number     // DEXA pct_fat
  measuredPct: number      // body_metrics.body_fat_pct on scaleDate
}

export interface BodyFatCalibration {
  source: string           // 'scale_ble' — the instrument this correction belongs to
  offsetPct: number        // referencePct − measuredPct, averaged over the pairs
  pairs: CalibrationPair[] // never empty; a calibration with no pairs is `null`, not a zero offset
}

export function deriveBodyFatCalibration(pairs: CalibrationPair[], source: string): BodyFatCalibration | null
export function correctBodyFatPct(rawPct: number, source: string | null, cal: BodyFatCalibration | null): number
```

**`correctBodyFatPct` returns `rawPct` unchanged when the source does not match or there is no
calibration.** That is the rule from the owner's refinement (2): a different instrument is a different
bias, and applying the Renpho correction to Health Connect would be worse than applying none. A
`null` calibration must never collapse into a zero offset silently — the caller has to be able to
tell "corrected by 0.0" from "not corrected", because the UI says different things.

**Clamp the corrected value into `PLAUSIBLE_BODY_FAT_PCT`** (already in `body-composition.ts`) and
return the raw value rather than a clamped one if the correction pushes it out of band — a
calibration that produces an implausible number is a broken calibration, not a licence to store an
implausible number.

Tests are pure: pair derivation, the source key, the empty case, the clamp, and a mutation showing
each guard fails without it.

### Step 2 — one repository read that returns the pairs

`getBodyFatCalibration(userId)` in the repository interface + `adapter.ts`. One query joining
`dexa_scans` to `body_metrics` on the ±3-day window, grouped by `source_map->>'body_fat_pct'`.
Returns `BodyFatCalibration | null`.

**Scope every arm to `user_id`** — both tables have the column, so this is a two-predicate join and
there is no excuse for missing one.

### Step 3 — apply it at the read sites, all of them, in one PR

The sibling-surface sweep. Enumerated from `grep -rn 'bodyFatPct'`; these are the sites where a
stored reading becomes a derived number:

| Site | What it feeds |
|---|---|
| `lib/health/energy-balance-service.ts:124` | `bodyComposition` → BMR → TDEE / energy balance |
| `lib/data/postgres/adapter.ts:1906` `getBodyMetricsBaseline` | the nutrition goal's weight + body fat |
| `lib/data/postgres/slices/oura.ts:1762` | the `oura_daily_derived.body_comp` snapshot backfill |
| `app/health/health-sections.tsx:285` | the displayed panel (Lane B, §4) |

**`personalRmr` is the one that must not be missed, and the entry is right about why.** It re-scales a
measured RMR's Cunningham residual onto **today's** fat-free mass. `ffm_kg_at_test` comes from the
DEXA (51.46 kg); today's comes from the scale. Feed it the **uncorrected** scale number and the two
are from different instruments: 53.56 kg against 51.46 kg, which re-scales the residual onto
**+45 kcal/day** of fat-free mass the owner does not have — on the very first day, and permanently.

It does not need its own patch. `goal-recommendation.ts:178` calls
`personalRmr(input.measuredRmr, leanMassKg)` where `leanMassKg` comes from
`bodyComposition(input.weightKg, input.bodyFatPct)`, so **correcting the input `bodyFatPct` fixes it
by construction.** That is exactly why the correction goes in at the input boundary rather than at
each consumer — but it must be *verified*, not assumed, with a test that asserts the RMR moves.

### Step 4 — surface the correction in the payload

Whatever the goal/energy-balance responses already return gains the calibration alongside the
corrected value: `{ bodyFatPct, bodyFatPctRaw, corrected: boolean, calibration: { offsetPct, pairs }
| null }`. The UI cannot honestly label a corrected number without being told it was corrected and by
how much, and the owner explicitly asked to be shown the offset. **`corrected` is per reading, not
per response** — §2.3b is why: two-thirds of the history is on instruments this calibration does not
cover, so a series carries both kinds and the chart has to be able to tell them apart.

---

## 4. Lane B — the display half

Not this lane's to build; listed so the split is on the record.

- The body-composition panel shows the corrected body fat, with the raw reading and the offset
  available rather than hidden.
- **The uncorrected BIA columns (§2.4) are labelled as uncorrected.** A corrected fat % sitting
  silently beside an uncorrected muscle mass is the internal inconsistency the entry's trap 1 warned
  about, and labelling is the honest fix.
- With no calibration, the panel reads exactly as it does today — no empty state, no placeholder.

---

## 5. Done looks like

- A DEXA row and a same-period `scale_ble` reading produce a calibration with **one** pair, derived
  rather than stored.
- The corrected body fat reaches the calorie goal, the protein goal, the energy balance, and
  `personalRmr`'s current fat-free mass — each proven by a test that fails without the correction.
- History reads corrected. `body_metrics.body_fat_pct` still holds every raw scale value.
- A source with no pairs reads uncorrected, and "no calibration" is distinguishable from "an offset
  of zero".
- **Not** done by this work: the owner still cannot enter a scan (LA-44), so the outcome is
  unobservable in the app until that ships.

## 6. Measured leverage, so the size of this is on the record

BMR is linear in body-fat %, so the error is exact rather than estimated:
`d(BMR)/d(BF point) = −weightKg × 0.216 = −15.4 kcal/day per point` at 71.25 kg, carried through
`SEDENTARY_MULTIPLIER` (1.2) as **−18.5 kcal/day per point** on the calorie goal. The measured 3.2-point
gap is therefore worth **≈59 kcal/day on the calorie goal** and **≈5 g/day on the protein goal**
(dosed per kg of lean mass, `PROTEIN_G_PER_KG_BY_GOAL` = 2.2 for recomp) — plus the +45 kcal/day
`personalRmr` error above, which is a separate and additive mistake.
