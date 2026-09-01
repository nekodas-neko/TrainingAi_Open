/**
 * Blood-panel analytes: the normalised key for each result, and whether a value sits outside its
 * reference range (BF-1).
 *
 * A dependency-free leaf module, deliberately — the same reason `energy-baseline.ts` is one. The
 * extraction route, the manual form and every consumer must agree on these keys, and a client
 * component asking "is this out of range" must not drag a server-only chain into its bundle.
 *
 * **`analyte_key` is normalised; the provider's `label` is stored beside it and is not.** Labs
 * disagree — "LDL (calculated)" against "LDL-C" — so the key is what a consumer greps for and the
 * label is what the report said. Keeping both means changing provider does not orphan history.
 */

/** Which side of its reference range a result falls on, or that the question cannot be answered. */
export type RangeVerdict = 'low' | 'in' | 'high' | 'unknown'

/**
 * One analyte as stored. `valueNum` + `valueOperator` rather than a text blob: `<0.2` is a real
 * measurement (below the assay's detection limit), and storing `"<0.2"` makes it uncomparable while
 * storing `0.2` alone makes it **wrong**.
 */
export interface AnalyteReading {
  valueNum: number | null
  /** `'<'` or `'>'` when the result is bounded rather than exact. Applies to the VALUE, not the range. */
  valueOperator: '<' | '>' | null
  refLow: number | null
  refHigh: number | null
}

/**
 * Whether a result is outside its reference range — **computed, never read off the report's flag.**
 *
 * The real panel is why this rule is written down rather than assumed. Its flags are free-text
 * commentary: a creatinine of 109 against a 60–130 range is flagged *"Normal (athletic)"* and a
 * urea of 9.2 against 2.5–8.0 is *"High (likely protein intake)"*. Those are a clinician's reading,
 * not a boolean, and CLAUDE.md is explicit that no self-reported judgement may be shown as fact.
 * The flag is displayed as the provider's words; this decides the colour.
 *
 * **`'unknown'` is a real answer and the operator is why.** A result of `>59` with an upper bound
 * genuinely does not say whether it is above that bound, and returning `'in'` there would be a
 * guess dressed as a measurement. Callers render `'unknown'` as no verdict rather than as normal.
 */
export function rangeVerdict(a: AnalyteReading): RangeVerdict {
  const { valueNum: v, valueOperator: op, refLow, refHigh } = a
  if (v == null) return 'unknown'
  if (refLow == null && refHigh == null) return 'unknown'

  if (op == null) {
    if (refLow != null && v < refLow) return 'low'
    if (refHigh != null && v > refHigh) return 'high'
    return 'in'
  }

  // `<v` — the true result is somewhere below v.
  if (op === '<') {
    // At or below the floor, it is below the floor whatever the true value is.
    if (refLow != null && v <= refLow) return 'low'
    // Below the ceiling with no floor to fail, it is inside whatever the true value is.
    if (refLow == null && refHigh != null && v <= refHigh) return 'in'
    return 'unknown'
  }

  // `>v` — the true result is somewhere above v.
  if (refHigh != null && v >= refHigh) return 'high'
  if (refHigh == null && refLow != null && v >= refLow) return 'in'
  return 'unknown'
}

/**
 * `"< 0.2"` / `"9.2"` / `"0.06"` → `{ valueNum, valueOperator }`.
 *
 * Shared so the extraction route and the manual form cannot disagree about what `<0.2` means. A
 * result that is not a number at all returns `valueNum: null` rather than throwing — the row still
 * stores, carrying its label and the provider's own text, which is what makes a partial panel
 * useful instead of rejected.
 */
export function parseResult(raw: string): { valueNum: number | null; valueOperator: '<' | '>' | null } {
  const t = raw.trim()
  const m = /^([<>])?\s*(-?\d+(?:\.\d+)?)$/.exec(t)
  if (!m) return { valueNum: null, valueOperator: null }
  return { valueNum: Number(m[2]), valueOperator: (m[1] as '<' | '>' | undefined) ?? null }
}

/**
 * `"2.5–8.0"` / `"<25"` / `">59"` / `"—"` → `{ refLow, refHigh }`, both nullable.
 *
 * All four shapes are in the real report, which is why both bounds are nullable rather than one
 * column with a convention. En-dash and hyphen both appear; a leading minus is a negative bound
 * (T-scores) rather than a separator, so the split is anchored on a dash BETWEEN two numbers.
 */
export function parseReference(raw: string): { refLow: number | null; refHigh: number | null } {
  const t = raw.trim().replace(/\s+/g, '')
  const two = /^(-?\d+(?:\.\d+)?)[–—-](-?\d+(?:\.\d+)?)$/.exec(t)
  if (two) return { refLow: Number(two[1]), refHigh: Number(two[2]) }
  const one = /^([<>])(-?\d+(?:\.\d+)?)$/.exec(t)
  if (one) return one[1] === '<' ? { refLow: null, refHigh: Number(one[2]) } : { refLow: Number(one[2]), refHigh: null }
  return { refLow: null, refHigh: null }
}

/**
 * Provider label → normalised key, seeded from the 63 rows of the real 2026-04 panel.
 *
 * Not exhaustive and not meant to be: an unrecognised label falls back to `slugAnalyte` below, so a
 * new marker stores rather than being dropped. What this table buys is that the markers a consumer
 * names — urea, LDL, fasting insulin — keep one key across providers who word them differently.
 */
export const ANALYTE_KEYS: Record<string, string> = {
  'insulin (fasting)': 'insulin_fasting',
  'glucose (fasting)': 'glucose_fasting',
  'serum cortisol (10am)': 'cortisol',
  'prolactin': 'prolactin',
  'lh': 'lh',
  'fsh': 'fsh',
  'oestradiol': 'oestradiol',
  'progesterone': 'progesterone',
  'testosterone (total)': 'testosterone_total',
  'free testosterone (calc)': 'testosterone_free',
  'shbg': 'shbg',
  'growth hormone': 'growth_hormone',
  'igf-1': 'igf_1',
  'dhea-s': 'dhea_s',
  'sodium': 'sodium',
  'potassium': 'potassium',
  'chloride': 'chloride',
  'bicarbonate': 'bicarbonate',
  'other anions': 'anion_gap',
  'urea': 'urea',
  'creatinine': 'creatinine',
  'egfr': 'egfr',
  'uric acid': 'uric_acid',
  'total bilirubin': 'bilirubin_total',
  'alkaline phosphatase': 'alp',
  'gamma gt': 'ggt',
  'alt': 'alt',
  'ast': 'ast',
  'ld': 'ldh',
  'calcium': 'calcium',
  'adjusted calcium': 'calcium_adjusted',
  'phosphate': 'phosphate',
  'total protein': 'protein_total',
  'albumin': 'albumin',
  'globulins': 'globulins',
  'cholesterol (total)': 'cholesterol_total',
  'triglycerides': 'triglycerides',
  'hdl': 'hdl',
  'ldl (calculated)': 'ldl_calculated',
  'non-hdl': 'non_hdl',
  'total/hdl ratio': 'cholesterol_hdl_ratio',
  'magnesium': 'magnesium',
  'crp': 'crp',
  'haemoglobin': 'haemoglobin',
  'red cell count': 'rbc',
  'haematocrit': 'haematocrit',
  'mcv': 'mcv',
  'mch': 'mch',
  'mchc': 'mchc',
  'rdw': 'rdw',
  'platelets': 'platelets',
  'mpv': 'mpv',
  'wbc': 'wbc',
  'neutrophils': 'neutrophils',
  'lymphocytes': 'lymphocytes',
  'monocytes': 'monocytes',
  'eosinophils': 'eosinophils',
  'basophils': 'basophils',
}

/** Fallback key for a label the table does not know: lowercase, non-alphanumerics to `_`. */
export function slugAnalyte(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** The key for a provider's label — the table when it knows it, a slug when it does not. */
export function analyteKey(label: string): string {
  return ANALYTE_KEYS[label.trim().toLowerCase()] ?? slugAnalyte(label)
}
