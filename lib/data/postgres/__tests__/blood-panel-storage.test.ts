/**
 * BF-1 — a blood panel round-trips with every shape the real report contains.
 *
 * The plan's verification is one sentence: *"a synthetic panel carrying all six shapes round-trips:
 * stored, read back, and every shape survives — especially `<0.2` and the month-precision date."*
 * The shapes are not invented; each is a row in `docs/clinical-baseline-2026-08-27.md`, which is the
 * de-identified 2026-04 panel this schema was written from.
 *
 * **The one that a simpler schema loses is `<0.2`.** A result below the assay's detection limit is
 * a real measurement; stored as text it is uncomparable, stored as `0.2` it is wrong. Both columns
 * have to survive the round trip or the design has bought nothing.
 *
 * Runs only against a real local dev Postgres — skips cleanly in CI.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { rangeVerdict } from '@trainingai/shared/health/analyte-keys'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000000b1'
const OTHER = '00000000-0000-4000-8000-0000000000b2'

/** Straight from the report — the shapes, not a sample of convenience. */
const ANALYTES = [
  // two-sided range, out high, and a flag that is commentary
  { analyteKey: 'urea', label: 'Urea', unit: 'mmol/L', valueNum: 9.2, valueOperator: null, refLow: 2.5, refHigh: 8.0, flagText: 'High (likely protein intake)' },
  // two-sided range, INSIDE it, and a flag that reads like a verdict and is not
  { analyteKey: 'creatinine', label: 'Creatinine', unit: 'umol/L', valueNum: 109, valueOperator: null, refLow: 60, refHigh: 130, flagText: 'Normal (athletic)' },
  // one-sided high bound
  { analyteKey: 'ldl_calculated', label: 'LDL (calculated)', unit: 'mmol/L', valueNum: 3.57, valueOperator: null, refLow: null, refHigh: 2.5, flagText: 'High' },
  // one-sided LOW bound — the other direction, which a single nullable column cannot express
  { analyteKey: 'egfr', label: 'eGFR', unit: 'mL/min', valueNum: 76, valueOperator: null, refLow: 59, refHigh: null, flagText: 'Normal' },
  // the result that is not a number
  { analyteKey: 'growth_hormone', label: 'Growth hormone', unit: 'mIU/L', valueNum: 0.2, valueOperator: '<' as const, refLow: null, refHigh: 19, flagText: 'Normal' },
  // no reference range at all
  { analyteKey: 'cholesterol_hdl_ratio', label: 'Total/HDL ratio', unit: null, valueNum: 4.4, valueOperator: null, refLow: null, refHigh: null, flagText: 'Borderline' },
]

describe.skipIf(!canRun)('blood panels', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `bf1-${id}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM blood_panels WHERE user_id = ANY($1)', [[USER, OTHER]])
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[USER, OTHER]])
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM blood_panels WHERE user_id = ANY($1)', [[USER, OTHER]])
  })

  const save = (userId = USER, over: Record<string, unknown> = {}) => repo.saveBloodPanel(userId, {
    collectedOn: '2026-04-01', datePrecision: 'month', labName: 'Spec Lab', source: 'manual',
    analytes: ANALYTES, ...over,
  } as Parameters<typeof repo.saveBloodPanel>[1])

  it('every shape survives the round trip', async () => {
    await save()
    const [panel] = await repo.listBloodPanels(USER)

    expect(panel.collectedOn).toBe('2026-04-01')
    // Without this the record claims a day the report never gave.
    expect(panel.datePrecision, 'month precision was flattened to a day').toBe('month')
    expect(panel.analytes).toHaveLength(ANALYTES.length)

    const by = Object.fromEntries(panel.analytes.map(a => [a.analyteKey, a]))

    // The result that is not a number: BOTH halves, or the design bought nothing.
    expect(by.growth_hormone.valueNum).toBe(0.2)
    expect(by.growth_hormone.valueOperator).toBe('<')

    // Both one-sided directions, and the absent range.
    expect([by.ldl_calculated.refLow, by.ldl_calculated.refHigh]).toEqual([null, 2.5])
    expect([by.egfr.refLow, by.egfr.refHigh]).toEqual([59, null])
    expect([by.cholesterol_hdl_ratio.refLow, by.cholesterol_hdl_ratio.refHigh]).toEqual([null, null])

    // The provider's words, verbatim.
    expect(by.creatinine.flagText).toBe('Normal (athletic)')
    expect(by.creatinine.label).toBe('Creatinine')
  })

  /**
   * The rule the whole entry turns on. `flag_text` is stored and displayed; the verdict is computed
   * from the bounds. A creatinine of 109 inside 60–130 is IN RANGE whatever *"Normal (athletic)"*
   * suggests, and a urea of 9.2 is out whatever hedge follows it.
   */
  it('out-of-range is derived from the bounds, not from the flag', async () => {
    await save()
    const [panel] = await repo.listBloodPanels(USER)
    const verdicts = Object.fromEntries(panel.analytes.map(a => [a.analyteKey, rangeVerdict(a)]))

    expect(verdicts.urea).toBe('high')
    expect(verdicts.ldl_calculated).toBe('high')
    expect(verdicts.creatinine).toBe('in')
    expect(verdicts.egfr).toBe('in')
    expect(verdicts.growth_hormone).toBe('in')
    // No bounds is not "normal" — it is unanswerable, and saying so is the point.
    expect(verdicts.cholesterol_hdl_ratio).toBe('unknown')
  })

  /**
   * The correct-then-save flow. Extraction prefills, the owner fixes a misread decimal, and saves
   * again — so re-saving must REPLACE, not append. Appending leaves the wrong row beside the right
   * one under the same key, and the unique constraint then rejects the corrected one.
   */
  it('re-saving the same panel replaces its results rather than appending', async () => {
    await save()
    const corrected = ANALYTES.map(a => a.analyteKey === 'urea' ? { ...a, valueNum: 6.2, flagText: 'Normal' } : a)
    await save(USER, { analytes: corrected })

    const panels = await repo.listBloodPanels(USER)
    expect(panels, 'a second panel was created instead of the first being corrected').toHaveLength(1)
    expect(panels[0].analytes).toHaveLength(ANALYTES.length)
    const urea = panels[0].analytes.find(a => a.analyteKey === 'urea')!
    expect(urea.valueNum).toBe(6.2)
    expect(rangeVerdict(urea)).toBe('in')
  })

  it('a panel with no analytes at all stores, rather than being rejected', async () => {
    // A partial panel is useful; a rejected one is not. The header is worth keeping on its own.
    await save(USER, { analytes: [] })
    const [panel] = await repo.listBloodPanels(USER)
    expect(panel.analytes).toEqual([])
  })

  it('is scoped to its user, on every path', async () => {
    await save(OTHER)
    expect(await repo.listBloodPanels(USER)).toEqual([])

    const [theirs] = await repo.listBloodPanels(OTHER)
    // A panel id from another account must not be deletable, and must answer the same as absent.
    expect(await repo.deleteBloodPanel(USER, theirs.id)).toBe(false)
    expect(await repo.listBloodPanels(OTHER)).toHaveLength(1)

    expect(await repo.deleteBloodPanel(OTHER, theirs.id)).toBe(true)
    expect(await repo.listBloodPanels(OTHER)).toEqual([])
  })

  it('a soft-deleted panel stays out of the list and is not deletable twice', async () => {
    const saved = await save()
    expect(await repo.deleteBloodPanel(USER, saved.id)).toBe(true)
    expect(await repo.listBloodPanels(USER)).toEqual([])
    expect(await repo.deleteBloodPanel(USER, saved.id), 'a tombstoned panel deleted again').toBe(false)
  })

  /**
   * De-identification is a property of the schema, not of a filter someone remembers to apply.
   * A column that could carry a name is the failure; asserting there is none is cheap.
   */
  it('the tables carry no column that could identify a person', async () => {
    const { rows } = await pool.query<{ column_name: string; table_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('blood_panels','blood_analytes')`)
    const suspicious = rows.filter(r => /name|dob|birth|patient|address|nhi|medicare|phone|email/i.test(r.column_name))
    // `lab_name` is instrument metadata and is the one allowed match.
    expect(suspicious.map(r => `${r.table_name}.${r.column_name}`)).toEqual(['blood_panels.lab_name'])
  })
})
