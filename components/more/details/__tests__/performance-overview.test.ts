import { describe, expect, it } from 'vitest'
import {
  dexaReadings, fitnessTestReadings, measuredRmrReadings, performanceGroups,
  type DexaScanRow, type FitnessTestRow, type MeasuredRmrRow,
} from '../performance-overview'

/**
 * The two rows `fitness_tests` actually holds in production (BF-133's inventory, 2026-09-08): a
 * six-minute walk that produced a VO₂max estimate and nothing else, and a resting-HRR test that
 * produced heart rates and nothing else. They are the reason the readings are built per metric
 * rather than per test.
 */
const TESTS: FitnessTestRow[] = [
  { date: '2026-07-19', testType: '6mwt', distanceM: 520, vo2maxEst: 18.8 },
  { date: '2026-07-19', testType: 'resting_hrr', restingHr: 94, hrr1Bpm: 21, maxHr: 138 },
]

describe('fitnessTestReadings — one row per metric, not per test', () => {
  it('reads each metric off whichever test produced it', () => {
    const out = fitnessTestReadings(TESTS)
    expect(out.map(r => r.label)).toEqual([
      'VO₂max',
      'Heart-rate recovery, 1 min',
      'Resting heart rate at test',
      'Peak heart rate at test',
      'Distance covered',
    ])
    expect(out.find(r => r.label === 'VO₂max')?.value).toBe('18.8 ml/kg/min')
    expect(out.find(r => r.label === 'Distance covered')?.value).toBe('520 m')
  })

  it('says the VO₂max is estimated, because the column is an estimate', () => {
    expect(fitnessTestReadings(TESTS).find(r => r.label === 'VO₂max')?.note)
      .toMatch(/estimated/)
  })

  it('does not call a test morning the resting heart rate', () => {
    // Vitals already carries the daily ring figure under that exact name. Two windows, two numbers.
    const row = fitnessTestReadings(TESTS).find(r => r.label === 'Resting heart rate at test')
    expect(row?.value).toBe('94 bpm')
    expect(row?.note).toMatch(/daily figure/)
  })

  it('takes the later test when two carry the same metric', () => {
    const out = fitnessTestReadings([
      ...TESTS,
      { date: '2026-08-30', testType: 'resting_hrr', restingHr: 88 },
    ])
    const row = out.find(r => r.label === 'Resting heart rate at test')
    expect(row?.value).toBe('88 bpm')
    expect(row?.asOf).toBe('2026-08-30')
  })

  it('does not depend on the rows arriving in order', () => {
    const out = fitnessTestReadings([
      { date: '2026-08-30', testType: 'resting_hrr', restingHr: 88 },
      ...TESTS,
    ])
    expect(out.find(r => r.label === 'Resting heart rate at test')?.asOf).toBe('2026-08-30')
  })

  it('omits a metric no test has ever produced rather than printing a blank', () => {
    expect(fitnessTestReadings([{ date: '2026-07-19', testType: '6mwt', vo2maxEst: 18.8 }])
      .map(r => r.label)).toEqual(['VO₂max'])
  })

  it('ignores a non-finite value instead of rendering NaN', () => {
    expect(fitnessTestReadings([{ date: '2026-07-19', vo2maxEst: Number.NaN }])).toEqual([])
  })
})

describe('dexaReadings — the handful nothing else in the app measures', () => {
  const scan: DexaScanRow = {
    scannedOn: '2026-06-02',
    pctFat: 24.3, leanPlusBmcG: 63_400, fatG: 21_900,
    totalBmd: 1.234, tScore: 0.4, vatMassG: 480, androidGynoidRatio: 1.08,
  }

  it('converts the report grams to kilograms', () => {
    const out = dexaReadings([scan])
    expect(out.find(r => r.label === 'Fat-free mass')?.value).toBe('63.4 kg')
    expect(out.find(r => r.label === 'Fat mass')?.value).toBe('21.9 kg')
    // Two decimals: half a kilogram of visceral fat rounds to 0 at one.
    expect(out.find(r => r.label === 'Visceral fat')?.value).toBe('0.48 kg')
  })

  it('says the body fat came from the scan, because the scale reports its own', () => {
    expect(dexaReadings([scan]).find(r => r.label === 'Body fat')?.note).toMatch(/scale/)
  })

  it('keeps bone density at three decimals, where the differences live', () => {
    expect(dexaReadings([scan]).find(r => r.label === 'Bone density')?.value).toBe('1.234 g/cm²')
  })

  it('carries the scan date on every row', () => {
    expect(dexaReadings([scan]).every(r => r.asOf === '2026-06-02')).toBe(true)
  })

  it('keeps a T-score of 0, which is the reference mean and not "no value"', () => {
    const out = dexaReadings([{ scannedOn: '2026-06-02', tScore: 0 }])
    expect(out.map(r => r.label)).toEqual(['Bone density T-score'])
    expect(out[0].value).toBe('0.0')
  })

  it('is empty when no scan has been recorded', () => {
    expect(dexaReadings([])).toEqual([])
  })
})

describe('measuredRmrReadings — the lab number, named apart from the scale one', () => {
  const rmr: MeasuredRmrRow[] = [{ measuredOn: '2026-05-11', rmrKcal: 1725, ffmKgAtTest: 62.8 }]

  it('renders the measurement with its date', () => {
    const row = measuredRmrReadings(rmr).find(r => r.label === 'Resting rate, measured')
    expect(row?.value).toBe('1,725 kcal')
    expect(row?.asOf).toBe('2026-05-11')
    expect(row?.note).toMatch(/scale estimates/)
  })

  it('omits the fat-free mass when the provider reported a rate and no composition', () => {
    expect(measuredRmrReadings([{ measuredOn: '2026-05-11', rmrKcal: 1725 }]).map(r => r.label))
      .toEqual(['Resting rate, measured'])
  })
})

describe('performanceGroups — an empty group is dropped whole', () => {
  it('drops the groups with nothing in them rather than printing headings', () => {
    // `blood_panels` has never had a row and this is the same shape: a fixed set of cards would
    // render a screen mostly made of section titles.
    expect(performanceGroups({ fitnessTests: TESTS }).map(g => g.title)).toEqual(['Performance tests'])
  })

  it('is empty, not a list of empty groups, when nothing has been recorded', () => {
    expect(performanceGroups({})).toEqual([])
  })

  it('orders the groups tests → scan → metabolic test', () => {
    const groups = performanceGroups({
      fitnessTests: TESTS,
      dexaScans: [{ scannedOn: '2026-06-02', pctFat: 24.3 }],
      measuredRmr: [{ measuredOn: '2026-05-11', rmrKcal: 1725 }],
    })
    expect(groups.map(g => g.title)).toEqual(['Performance tests', 'Body scan', 'Metabolic test'])
  })
})
