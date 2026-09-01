import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { displayBodyFat, isCorrectedReading, correctedSpan } from '../body-fat-display'

const ROOT = path.resolve(__dirname, '../../..')

/**
 * LA-45. `/api/body-metadata` and `/api/day-log` carry three body-fat fields per row: `bodyFat`
 * (raw), `bodyFatCorrected` and `bodyFatIsCorrected`. Screens must render the corrected one — the
 * calorie goal, the protein dose and `personalRmr` already do, so a screen showing raw disagrees
 * with the app's own arithmetic, which the entry calls worse than nothing being corrected.
 *
 * The read is anchored to the JSX expression that renders or derives, not to the whole file — the
 * raw field legitimately appears in the same files (the log sheet seeds from it, and `openLog` must
 * keep doing so). A guard matching anywhere in the file could not tell the two apart, which is the
 * exact shape that shipped four times this session.
 */
const DISPLAY_SITES: { file: string; forbidden: RegExp }[] = [
  // `metaRecent`/`metaRecentReversed` rows are payload rows; `.bodyFat` off one is the raw value.
  { file: 'components/health/body-fat-card.tsx',            forbidden: /\.bodyFat\b(?!Corrected|IsCorrected|Pct)/ },
  { file: 'components/health/metric-sheets.tsx',            forbidden: /\.bodyFat\b(?!Corrected|IsCorrected|Pct)/ },
  { file: 'components/health/day-detail/day-sections.tsx',  forbidden: /\bbody\.bodyFat\b(?!Corrected|IsCorrected)/ },
  { file: 'app/session-select/components/week-day-sheet.tsx', forbidden: /\bbodyMeta\.bodyFat\b(?!Corrected|IsCorrected)/ },
  { file: 'app/more/details/details-content.tsx',           forbidden: /\br\.bodyFat\b(?!Corrected|IsCorrected)|latestBf\??\.bodyFat\b/ },
  { file: 'components/profile/goals-section.tsx',           forbidden: /\br\.bodyFat\b(?!Corrected|IsCorrected)|latestBf\??\.bodyFat\b/ },
]

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

/** Comments name the raw field constantly, explaining why it must stay raw. Strip them, or the
 *  guard passes on prose — the "it matched its own comment" failure this repo keeps hitting. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('every body-fat display site renders the corrected reading', () => {
  it('covers the sites that exist', () => {
    // A list that has drifted off the filesystem passes forever.
    for (const { file } of DISPLAY_SITES) expect(() => source(file), file).not.toThrow()
    expect(DISPLAY_SITES.length).toBeGreaterThanOrEqual(6)
  })

  it.each(DISPLAY_SITES)('$file uses displayBodyFat, not the raw field', ({ file, forbidden }) => {
    const src = code(source(file))
    expect(src, `${file} should import the display helper`).toMatch(/displayBodyFat/)
    expect(src.match(forbidden)?.[0] ?? null).toBeNull()
  })

  it('the log sheet still seeds from the RAW reading', () => {
    // The inverse, and the one that is silent and unrecoverable if broken: `openLog` POSTs its value
    // back at source `manual`, which outranks `scale_ble`. Seeding it from a corrected number would
    // overwrite the measurement permanently and collapse the next calibration toward zero.
    const src = code(source('app/health/health-content.tsx'))
    expect(src).toMatch(/const openLog[\s\S]{0,400}metaToday\?\.\[field\]/)
    expect(src).not.toMatch(/const openLog[\s\S]{0,400}displayBodyFat/)
  })
})

describe('the display rule itself', () => {
  it('prefers the corrected value and falls back to raw', () => {
    expect(displayBodyFat({ bodyFat: 25.3, bodyFatCorrected: 28.5 })).toBe(28.5)
    expect(displayBodyFat({ bodyFat: 25.3 })).toBe(25.3)
    expect(displayBodyFat({ bodyFat: null })).toBeNull()
    expect(displayBodyFat(null)).toBeNull()
    expect(displayBodyFat(undefined)).toBeNull()
  })

  it('never infers "corrected" from the two values differing', () => {
    // An offset can round to zero. "Corrected by 0.0" and "not corrected" are different claims, and
    // conflating them is what would let a chart draw the instrument changeover as an unexplained step.
    expect(isCorrectedReading({ bodyFat: 25.3, bodyFatCorrected: 25.3, bodyFatIsCorrected: true })).toBe(true)
    expect(isCorrectedReading({ bodyFat: 25.3, bodyFatCorrected: 28.5 })).toBe(false)
    expect(isCorrectedReading({ bodyFat: 25.3 })).toBe(false)
  })

  it('counts the corrected span over a mixed window', () => {
    expect(correctedSpan([
      { bodyFat: 20, bodyFatCorrected: 20 },                            // uncorrected instrument
      { bodyFat: 21, bodyFatCorrected: 24.2, bodyFatIsCorrected: true },
      { bodyFat: null },                                                // no reading — not counted
      { bodyFat: 22, bodyFatCorrected: 25.2, bodyFatIsCorrected: true },
    ])).toEqual({ corrected: 2, total: 3 })
  })
})
