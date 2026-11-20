import { describe, it, expect } from 'vitest'
import { elevatedAreas, stressBridges, stressRuns, STRESS_ELEVATED_LEVEL, STRESS_RUN_GAP_MS } from '../stress-day-line'
import { STRESS_HIGH_LEVEL } from '../daytime-stress-thresholds'

const MIN = 60_000

describe('stressRuns (#3939)', () => {
  it('splits at a gap longer than 75 minutes and tolerates one dropped bucket', () => {
    const b = [0, 30, 90, 200, 230].map(m => ({ t: m * MIN, level: 0 }))
    expect(stressRuns(b).map(r => r.map(p => p.t / MIN))).toEqual([[0, 30, 90], [200, 230]])
    expect(STRESS_RUN_GAP_MS).toBe(75 * MIN)
  })

  it('sorts first, so a back-filled day never doubles back', () => {
    const b = [{ t: 60 * MIN, level: 0 }, { t: 0, level: 0 }, { t: 30 * MIN, level: 0 }]
    expect(stressRuns(b)[0].map(p => p.t)).toEqual([0, 30 * MIN, 60 * MIN])
  })
})

describe('stressBridges (#3939)', () => {
  it('joins the last reading of each run to the first of the next, and nothing before or after', () => {
    const a = { x: 1, level: 0 }, b = { x: 2, level: -0.2 }, c = { x: 5, level: 0.3 }, d = { x: 9, level: -1 }
    expect(stressBridges([[a, b], [c], [d]])).toEqual([[b, c], [c, d]])
    expect(stressBridges([[a, b]])).toEqual([])
    expect(stressBridges([])).toEqual([])
  })
})

describe('elevatedAreas (#3939)', () => {
  it('is the Home strip\'s High threshold', () => {
    expect(STRESS_ELEVATED_LEVEL).toBe(STRESS_HIGH_LEVEL)
    expect(STRESS_ELEVATED_LEVEL).toBe(-0.5)
  })

  it('fills between the line and the threshold where it is past it, closing on the crossings', () => {
    const run = [{ x: 0, level: 0 }, { x: 10, level: -1 }, { x: 20, level: 0 }]
    expect(elevatedAreas(run)).toEqual([[
      { x: 5, level: -0.5 }, { x: 10, level: -1 }, { x: 15, level: -0.5 },
    ]])
  })

  it('starts and ends on the threshold at a run that begins or ends elevated', () => {
    const run = [{ x: 0, level: -1 }, { x: 10, level: -0.8 }]
    expect(elevatedAreas(run)).toEqual([[
      { x: 0, level: -0.5 }, { x: 0, level: -1 }, { x: 10, level: -0.8 }, { x: 10, level: -0.5 },
    ]])
  })

  it('gives two areas for two excursions, none for a calm run, none for a lone reading', () => {
    const run = [-1, 0, -1].map((level, i) => ({ x: i * 10, level }))
    expect(elevatedAreas(run)).toHaveLength(2)
    expect(elevatedAreas([{ x: 0, level: 0.2 }, { x: 10, level: -0.4 }])).toEqual([])
    expect(elevatedAreas([{ x: 0, level: -1 }])).toEqual([])
  })

  it('never fills a bridge: it reads runs only, so a gap between elevated runs stays unfilled', () => {
    const runs = [[{ x: 0, level: -1 }, { x: 10, level: -1 }], [{ x: 100, level: -1 }, { x: 110, level: -1 }]]
    const areas = runs.flatMap(r => elevatedAreas(r))
    expect(areas).toHaveLength(2)
    expect(areas.every(a => Math.max(...a.map(v => v.x)) - Math.min(...a.map(v => v.x)) === 10)).toBe(true)
  })
})
