# Clinical baseline — DEXA, RMR (27 Aug 2026) and blood panel (Apr 2026)

**Why this file exists.** The owner had a DEXA scan and an indirect-calorimetry RMR test on
2026-08-27 and sent a blood panel from 2026-04, ahead of the import pipeline that would normally
store them ([BF-41](implementation-backlog.md), which is not built yet). Left in a chat thread these
numbers are lost when the session ends, and three queued entries — **BF-2** (scale calibration),
**BF-33** (measured RMR) and **BF-1** (blood import) — were each filed *waiting on exactly these
values*. This is the durable copy, and it is also the **real report** that BF-41's own rule demands
schemas be written from rather than invented from a description.

**⚠ De-identified on purpose.** Patient name, date of birth and the provider's patient reference
appear on the source reports and are **deliberately absent here and must stay absent** — from this
file, from backlog entries, from commit messages and from PR bodies. Only clinical values and
instrument metadata are recorded. This is separate from, and does not substitute for, the app's own
crop-before-upload step (BF-1's decided rule, extended to every document type by BF-41): the
extraction call sends the document to Google, so redacting after extraction is too late.

---

## 1. DEXA — 27 August 2026

Hologic Horizon A (S/N 307883M), Auto Whole Body Fan Beam, analysis version 13.6.1.3, scan ID
A08272607. Sex male, height 158.1 cm, weight 72.1 kg, age 33, BMI 28.8 (WHO: Overweight).

**Bone**

| | Value |
|---|---|
| Total BMD | 1.046 g/cm² |
| T-score | −1.6 |
| Z-score | −1.6 |
| Total BMC | 1927.25 g |
| Total BMD precision (CV) | 1.0 % |

Per-region BMD / BMC / Area is reported for 11 rows (L arm, R arm, L ribs, R ribs, T spine, L spine,
pelvis, L leg, R leg, subtotal, head, total). References: T- and Z-scores vs White Male,
2012 BMDCS/NHANES.

**Body composition**

| | Value |
|---|---|
| Fat | 20,547.5 g |
| Lean | 49,532.8 g |
| **Lean + BMC (FFM)** | **51,460.1 g** |
| Total mass | 72,007.6 g |
| **% Fat** | **28.5 %** (Young Normal 93, Age Matched 89) |
| Android (A) % fat | 36.0 % |
| Gynoid (G) % fat | 30.3 % |

**Adipose indices**

| | Value |
|---|---|
| Fat mass / height² | 8.22 kg/m² |
| Android / Gynoid ratio | 1.19 |
| % Fat trunk / legs | 0.98 |
| Trunk / limb fat mass | 0.99 |
| Est. VAT mass | 305 g |
| Est. VAT volume | 330 cm³ |
| Est. VAT area | 63.3 cm² |

**Lean indices**

| | Value |
|---|---|
| Lean / height² | 19.8 kg/m² |
| Appendicular lean / height² | 9.46 kg/m² |

Body-composition reference: AIMSS.

---

## 2. RMR — 27 August 2026

Indirect calorimetry, performed by "Josh".

| | Value |
|---|---|
| **Measured RMR** | **1325 kcal/day** |
| Predicted RMR (standard equations) | 1549 kcal/day |
| Difference | **−14 % below predicted** |

The report gives **two activity-factor variants** because the owner could not decide which described
them — *"should be 2 different activity levels; as I coudlnt decide which one was I was"*. Both are
recorded; **neither is authoritative**:

| Activity level | Projected TDEE (from calorimetry) | Predicted TDEE (from equations) |
|---|---|---|
| **Mild** | 1822 kcal/day | 2130 kcal/day |
| **Moderate** | 2054 kcal/day | 2401 kcal/day |

Provider's own caveat, worth carrying into any UI that shows these: the **RMR measurement** is the
accurate part; the **projected TDEE** carries an assumption-based margin of error because the
activity factor is a guess.

---

## 3. Blood panel — April 2026

Provided by the owner as a table, already de-identified. Flags are the provider's.

| Test | Unit | Reference | Result | Flag |
|---|---|---|---|---|
| Insulin (fasting) | mU/L | <25 | 4 | Optimal |
| Glucose (fasting) | mmol/L | 3.0–6.0 | 4.8 | Optimal |
| Serum cortisol (10am) | nmol/L | 140–690 | 170 | Low-normal |
| Prolactin | mIU/L | <300 | 203 | Normal |
| LH | IU/L | 1–10 | 4 | Normal |
| FSH | IU/L | 1–10 | 2 | Normal |
| Oestradiol | pmol/L | <150 | 116 | Normal |
| Progesterone | nmol/L | <3 | 1 | Normal |
| Testosterone (total) | nmol/L | 10–33 | 18 | Normal |
| Free testosterone (calc) | pmol/L | 150–700 | 415 | Normal |
| SHBG | nmol/L | 13–71 | 28 | Normal |
| Growth hormone | mIU/L | <19 | <0.2 | Normal |
| IGF-1 | nmol/L | 14–42 | 16 | Low-normal |
| DHEA-S | umol/L | 1.5–12.8 | 2 | Low-normal |
| Sodium | mmol/L | 137–147 | 143 | Normal |
| Potassium | mmol/L | 3.5–5.0 | 4.6 | Normal |
| Chloride | mmol/L | 96–109 | 104 | Normal |
| Bicarbonate | mmol/L | 25–33 | 30 | Normal |
| Other anions | mmol/L | 4–17 | 14 | Normal |
| Urea | mmol/L | 2.5–8.0 | 9.2 | **High** (likely protein intake) |
| Creatinine | umol/L | 60–130 | 109 | Normal (athletic) |
| eGFR | mL/min | >59 | 76 | Normal |
| Uric acid | mmol/L | 0.12–0.45 | 0.27 | Normal |
| Total bilirubin | umol/L | 2–20 | 7 | Normal |
| Alkaline phosphatase | U/L | 30–115 | 68 | Normal |
| Gamma GT | U/L | 0–70 | 24 | Normal |
| ALT | U/L | 0–45 | 46 | **Borderline high** (training-related) |
| AST | U/L | 0–41 | 24 | Normal |
| LD | U/L | 80–250 | 153 | Normal |
| Calcium | mmol/L | 2.15–2.60 | 2.28 | Normal |
| Adjusted calcium | mmol/L | 2.15–2.60 | 2.32 | Normal |
| Phosphate | mmol/L | 0.8–1.5 | 1 | Normal |
| Total protein | g/L | 60–82 | 73 | Normal |
| Albumin | g/L | 35–50 | 41 | Normal |
| Globulins | g/L | 20–40 | 32 | Normal |
| Cholesterol (total) | mmol/L | <4.0 | 5.1 | **High** |
| Triglycerides | mmol/L | <2.0 | 0.8 | Optimal |
| HDL | mmol/L | >1.0 | 1.17 | Good |
| LDL (calculated) | mmol/L | <2.5 | 3.57 | **High** |
| Non-HDL | mmol/L | <3.3 | 3.93 | **High** |
| Total/HDL ratio | — | <4.0 | 4.4 | **Borderline** |
| Magnesium | mmol/L | 0.7–1.1 | 0.8 | Normal |
| CRP | mg/L | 0–6 | 2.6 | Normal |
| Haemoglobin | g/L | 135–180 | 152 | Normal |
| Red cell count | ×10¹²/L | 4.2–6.0 | 5.9 | High-normal |
| Haematocrit | — | 0.38–0.52 | 0.47 | Normal |
| MCV | fL | 80–98 | 81 | Low-normal |
| MCH | pg | 27–35 | 26 | **Low** |
| MCHC | g/L | 310–365 | 322 | Normal |
| RDW | % | 11–15.5 | 13.3 | Normal |
| Platelets | ×10⁹/L | 150–450 | 237 | Normal |
| MPV | fL | — | 10.5 | Normal |
| WBC | ×10⁹/L | 4.0–11.0 | 6.1 | Normal |
| Neutrophils | ×10⁹/L | 2.0–7.5 | 3.6 | Normal |
| Lymphocytes | ×10⁹/L | 1.1–4.0 | 1.8 | Normal |
| Monocytes | ×10⁹/L | 0.2–1.0 | 0.5 | Normal |
| Eosinophils | ×10⁹/L | 0.04–0.40 | 0.18 | Normal |
| Basophils | ×10⁹/L | <0.21 | 0.06 | Normal |

**What this settles for BF-1's schema** — and it is the reason BF-41 says *do not design the field
list before seeing a real report*:

- **58 analytes in one panel**, in **6 provider-grouped sections** with no group labels of their own.
  A column-per-analyte table is not viable; the parent + child analyte row shape BF-41 specifies is
  confirmed by a real report.
- **Reference ranges are not two numbers.** They come as `low–high` (`3.0-6.0`), as one-sided
  (`<25`, `>59`), and as absent (MPV has none). `ref_low`/`ref_high` must both be nullable and the
  raw range string must be kept as given — reconstructing `<25` from a null low and a 25 high loses
  what the provider actually printed.
- **Results are not always numeric.** Growth hormone reads `<0.2` — below the assay's detection
  limit. A `numeric NOT NULL` value column cannot store it. Keep the printed text alongside a
  nullable parsed number.
- **Flags are free text with commentary**, not an enum: `Optimal`, `Low-Normal`, `High-Normal`,
  `Borderline`, `High (likely protein intake)`, `Normal (athletic)`. Store the string; do not
  normalise it into a three-state enum at ingest.
- **The panel date is a month, not a day** (`2026/04`). The date column has to tolerate
  month-precision or carry a precision flag.

---

## 4. What these measurements settle for the queued entries

### 4a. BF-2 — the calibration pair now exists

The whole point of BF-2 is one paired `(scan, scale)` observation. It exists as of 2026-08-27.
Same-day Renpho reading, from production `body_metrics`:

| | DEXA | Renpho (scale_ble) | Δ |
|---|---|---|---|
| Body fat | **28.5 %** | **25.3 %** | scale under-reads by **3.2 points** |
| Weight | 72.1 kg | 71.7 kg | scale reads 0.4 kg light |

Surrounding scale days for context (all `scale_ble`): 26 Aug 71.35 kg / 25.2 %, 25 Aug 71.25 kg /
25.2 %, 24 Aug 70.85 kg / 24.9 %.

**One pair still cannot distinguish an offset from a ratio** — which is exactly why BF-2's decided
design stores the *pairs* and derives the calibration form once there are two. Do not bake +3.2 in
as a constant.

### 4b. BF-33 — the measured RMR, and the estimate it contradicts

The app estimates RMR with Cunningham (`ffm × 21.6 + 370`). Against the measured 1325 kcal:

| Input | FFM | Cunningham | vs measured 1325 |
|---|---|---|---|
| DEXA lean + BMC | 51.46 kg | **1481** | **+156 over** |
| Renpho FFM (71.7 × (1 − 0.253)) | 53.56 kg | **1527** | **+202 over** |

So the over-estimate is **not** a body-composition error: even handed a perfect DEXA lean mass the
formula runs 156 kcal high for this person. That is the case for BF-33's precedence rule — a measured
value must override the estimate, not be averaged with it.

**The activity factor, which is the number the two provider variants were arguing about.** The app's
own learned maintenance (`adaptive-tdee.ts`) read **1,827 kcal** in the owner's Energy Balance
screenshot — within **5 kcal** of the provider's **Mild** projected TDEE of 1822. Against the
measured RMR that implies a real activity factor of **1827 ÷ 1325 ≈ 1.38**, sitting between the
provider's Mild and Moderate assumptions. Two independent methods landing 5 kcal apart is the
strongest validation the app's learned-maintenance model has had.

### 4c. BF-41 — the sequencing is unchanged, and now has real data behind it

BF-33's UI first (the table ships; these numbers have nowhere to be typed), then DEXA, then blood.
All three reports are now available in de-identified form in this file, so each schema can be
written from a real report rather than a description.
