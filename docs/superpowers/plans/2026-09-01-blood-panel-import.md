# BF-1 — blood panel import: the engine half

**Status:** plan only. Nothing here is built. Lane A owns everything in this document; the crop and
review surfaces are Lane B and are scoped at the end so the split is explicit rather than assumed.

**Why a plan first.** BF-1's own text says *"this entry is buildable once planned"*, and the backlog
protocol puts planning and building in separate PRs. This is PR 1.

---

## 1. The schema is written from a real report, not from a description

The de-identified panel in [`docs/clinical-baseline-2026-08-27.md`](../../clinical-baseline-2026-08-27.md)
is 58 analytes from April 2026, and every awkward shape the schema must survive is already in it.
Reading it rather than imagining it is the difference between a table that holds this report and one
that holds a description of one:

| shape | example from the real panel | what it forces |
|---|---|---|
| two-sided range | Glucose `3.0–6.0` | `ref_low` **and** `ref_high` |
| one-sided upper | Insulin `<25`, Cholesterol `<4.0` | `ref_high` alone, `ref_low` NULL |
| one-sided lower | eGFR `>59`, HDL `>1.0` | `ref_low` alone, `ref_high` NULL |
| **a result that is not a number** | Growth hormone `<0.2` | a number column **cannot** be the only value column |
| flag as commentary | Urea `High (likely protein intake)`, Creatinine `Normal (athletic)` | free text, and **never** parsed for meaning |
| month-precision date | "April 2026" | a date **plus** its precision, or every panel lands on the 1st and lies |

### Tables (migration N, Lane A only)

```
blood_panels
  id uuid pk · user_id uuid not null references users(id) on delete cascade
  collected_on date not null            -- month precision stores the 1st
  date_precision text not null          -- 'day' | 'month'
  lab_name text                         -- optional, no patient identifiers ever
  source text not null                  -- 'manual' | 'extracted'
  created_at timestamptz not null default now()
  unique (user_id, collected_on, lab_name)

blood_analytes
  id uuid pk · panel_id uuid not null references blood_panels(id) on delete cascade
  analyte_key text not null             -- normalised: 'urea', 'ldl_calculated'
  label text not null                   -- the provider's own wording, kept verbatim
  unit text
  value_num double precision            -- NULL when the result is not a number
  value_operator text                   -- '<' | '>' | NULL — `<0.2` is operator '<', num 0.2
  ref_low double precision · ref_high double precision
  flag_text text                        -- the provider's words, stored, never parsed
  unique (panel_id, analyte_key)
```

**`value_num` + `value_operator` rather than a text blob.** `<0.2` is a real measurement — below the
assay's detection limit — and storing `"<0.2"` as text makes it uncomparable while storing `0.2`
alone makes it *wrong*. Two columns keep it both readable and sortable, and a consumer that ignores
the operator is over-reading rather than crashing.

**Out-of-range is DERIVED, never the model's word.** `flag_text` is the provider's commentary and
is displayed as-is; whether a value sits outside its range is computed from `ref_low`/`ref_high` in
one shared helper. CLAUDE.md's rule is explicit — no LLM self-reported judgement may be shown as
fact — and *"Normal (athletic)"* on a creatinine of 109 against a 60–130 range is exactly the sort of
qualifier that must not become a boolean.

**`analyte_key` is normalised; `label` is not.** The key is what a consumer greps for; the label is
what the lab called it, and labs disagree ("LDL (calculated)" vs "LDL-C"). Keeping both means a
provider change does not orphan history. The normalisation table names all 58 keys in the real
panel and lives in `packages/shared/src/health/analyte-keys.ts` — one place, per One Formula One
Place, because the extraction route and the manual form must agree on it.

---

## 2. The extraction route copies a working pattern

`app/api/nutrition/scan/route.ts` is a vision→structured-data route that already does everything
this needs: `generateObject` with a Zod schema (**never** `JSON.parse` of model text),
`isAllowedImageMime` and `readJsonLimited` from `@trainingai/shared/http/request-guards`, and a
`rateLimit` at creation. `POST /api/blood-panel/scan` is the same shape with a different schema.

**It must not persist the image.** Extract, return the analytes, discard. That makes the
de-identification a property of the code rather than a promise about retention.

**The Zod schema mirrors the table**, including `valueOperator` and a nullable `valueNum`, so a
`<0.2` survives extraction instead of being coerced to 0.2 or dropped.

**Rate limit:** match the sibling AI routes. A panel import is rare; there is no case for a generous
limit on a route that calls a vision model.

---

## 3. The de-identification decision is already made, and it constrains this

Owner, 2026-08-23: **crop before upload**, the crop is *chosen* not fixed, and an already-cropped
file is accepted as-is. Route (c) — sending the whole report — is rejected and is not to be
revisited without a new owner decision.

Two consequences for the engine half:

- **The server must never receive an un-cropped document.** So the crop happens on-device, which
  makes it Lane B's, and this route simply accepts an image. There is no server-side crop to build.
- **Images only for v1.** `ALLOWED_IMAGE_MIME` is `jpeg/png/webp` and nothing in the tree renders a
  PDF. Adding a PDF→raster step would have to run on-device or the un-cropped PDF reaches the
  server, defeating the decision. `@capacitor/camera` with `CameraSource.Prompt` already gives
  camera-or-gallery, so photographing a printed report works with no new plumbing.

**🔴 The real report is never committed. This repository is public.** Test against a synthetic panel
built to match the layout. If the real one is ever needed to validate extraction, run it through a
local dev server by hand and commit nothing — git history makes a mistake here permanent.

---

## 4. What reads it — named, because a table nothing reads is the failure mode

BF-1 says it outright: *"the failure mode here is a table of 40 analytes that nothing ever reads"*,
and this repo already has two structurally-dead nutrition trend views. So the engine half is not
done until one surface changes. Three markers from the owner's own panel, with what each would
change:

1. **Urea 9.2 mmol/L against 2.5–8.0, flagged *"likely protein intake"*.** The app sets a protein
   target. A high urea alongside a high protein intake is the one biomarker in this panel that
   speaks directly to a number the app already recommends — so `goal-recommendation.ts` gains a line
   noting it, and does **not** silently lower the target: the reading is a prompt for a
   conversation, not an input to arithmetic.
2. **LDL 3.57 against <2.5, and non-HDL 3.93 against <3.3 — both high, with triglycerides 0.8
   (optimal) and HDL 1.17 (good).** That combination is a fat-*quality* signal rather than a
   fat-*quantity* one, which is exactly the distinction a macro split can act on and a single
   cholesterol number cannot.
3. **Fasting insulin 4 mU/L and glucose 4.8 mmol/L, both optimal.** The useful direction here is
   *negative*: it rules out the insulin-resistance story that a carbohydrate recommendation would
   otherwise have to hedge against, so the recommendation can stop hedging.

**First consumer: `app/api/ai/health-insight/route.ts`.** It already assembles a metric-line profile
from `body_metrics` + Oura, so biomarker lines drop in naturally and the change is small and
visible. `goal-recommendation.ts` follows.

**A panel goes stale.** April 2026 values must not be quoted in September as if measured today —
every consumer prints the collection date beside the value, and a panel older than ~12 months is
labelled as historical rather than dropped.

---

## 5. Split of work

| half | lane | what |
|---|---|---|
| migration, tables, `analyte-keys.ts`, repo methods | **A** | this document |
| `POST /api/blood-panel/scan`, `POST/GET /api/blood-panel` | **A** | this document |
| health-insight + goal-recommendation consumers | **A** | this document |
| on-device crop step, upload UI, review-and-correct form | **B** | a separate entry with `Needs:` pointing at this one |

**The typed form is the fallback and the confirm target**, and it is Lane B's. Extraction prefills,
the owner corrects, then it saves — so the engine must accept a fully manual panel with no
extraction call at all. Building the manual write path first is what makes the extraction route
optional rather than load-bearing.

## 6. Verification

- A synthetic panel carrying all six shapes in §1 round-trips: stored, read back, and every shape
  survives — especially `<0.2` and the month-precision date.
- Out-of-range is computed, and asserted against the real panel's numbers: urea, ALT, cholesterol,
  LDL and non-HDL are out; creatinine at 109 against 60–130 is **in**, whatever its flag says.
- One recommendation surface visibly changes because of a stored value.
- No image is persisted anywhere: asserted by a test that runs the scan route and checks the store.
