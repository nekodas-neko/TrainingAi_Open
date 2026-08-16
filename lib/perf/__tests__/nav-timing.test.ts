import { describe, it, expect } from 'vitest'
import {
  NAV_SAMPLE_LIMIT,
  appendNavSample,
  cleanNavLabel,
  isRscResourceName,
  normalizeNavPath,
  percentile,
  summarizeNavSamples,
  summarizeRscWindow,
  type NavSample,
} from '../nav-timing'

function sample(over: Partial<NavSample> = {}): NavSample {
  return {
    at: 1_770_000_000_000,
    label: 'Start',
    from: '/session-select',
    to: '/workout?session',
    urlMs: 100,
    paintMs: 120,
    settleMs: 200,
    rscCount: 1,
    rscMs: 90,
    ...over,
  }
}

describe('normalizeNavPath', () => {
  it('drops query values but keeps the parameter names', () => {
    expect(normalizeNavPath('/workout?session=8f14e45f-ea8d-4b1c-9c2a-1f2b3c4d5e6f')).toBe('/workout?session')
  })

  it('collapses uuid, numeric and date segments', () => {
    expect(normalizeNavPath('/exercise/8f14e45f-ea8d-4b1c-9c2a-1f2b3c4d5e6f')).toBe('/exercise/:id')
    expect(normalizeNavPath('/history/42')).toBe('/history/:n')
    expect(normalizeNavPath('/day/2026-08-04')).toBe('/day/:date')
  })

  it('keeps ordinary routes intact and normalises the root', () => {
    expect(normalizeNavPath('/health/sleep')).toBe('/health/sleep')
    expect(normalizeNavPath('http://localhost/')).toBe('/')
  })

  it('groups the same route reached with differently-ordered params together', () => {
    expect(normalizeNavPath('/health?tab=body&scroll=1')).toBe(normalizeNavPath('/health?scroll=9&tab=sleep'))
  })
})

describe('isRscResourceName', () => {
  it('recognises a Next route payload fetch and ignores ordinary assets', () => {
    expect(isRscResourceName('https://app/session-select?_rsc=1a2b3')).toBe(true)
    expect(isRscResourceName('https://app/_next/static/chunks/main.js')).toBe(false)
  })
})

describe('summarizeRscWindow', () => {
  const entries = [
    { name: '/a?_rsc=1', startTime: 100, duration: 50 }, // fully inside
    { name: '/b?_rsc=2', startTime: 10, duration: 5 },   // finished before the press
    { name: '/c?_rsc=3', startTime: 900, duration: 20 }, // started after the window closed
    { name: '/d.js', startTime: 110, duration: 500 },    // not an RSC fetch
  ]

  it('counts only payload fetches overlapping the navigation window', () => {
    expect(summarizeRscWindow(entries, 90, 300)).toEqual({ count: 1, totalMs: 50, maxMs: 50 })
  })

  it('counts a fetch still in flight when the URL changed — that is the cost being measured', () => {
    const inFlight = [{ name: '/a?_rsc=1', startTime: 100, duration: 400 }]
    expect(summarizeRscWindow(inFlight, 90, 200).count).toBe(1)
  })

  it('reports zero for a prefetched navigation, which is the warm signal', () => {
    expect(summarizeRscWindow([{ name: '/x.js', startTime: 100, duration: 5 }], 90, 300)).toEqual({
      count: 0,
      totalMs: 0,
      maxMs: 0,
    })
  })
})

describe('cleanNavLabel', () => {
  it('collapses whitespace and truncates', () => {
    expect(cleanNavLabel('  Start   workout\n')).toBe('Start workout')
    expect(cleanNavLabel('x'.repeat(60))).toHaveLength(40)
  })

  it('returns null for nothing usable', () => {
    expect(cleanNavLabel(null)).toBeNull()
    expect(cleanNavLabel('   ')).toBeNull()
  })
})

describe('appendNavSample', () => {
  it('keeps the most recent samples once the cap is reached', () => {
    let buf: NavSample[] = []
    for (let i = 0; i < NAV_SAMPLE_LIMIT + 5; i++) buf = appendNavSample(buf, sample({ settleMs: i }))
    expect(buf).toHaveLength(NAV_SAMPLE_LIMIT)
    expect(buf[0].settleMs).toBe(5)
    expect(buf[buf.length - 1].settleMs).toBe(NAV_SAMPLE_LIMIT + 4)
  })
})

describe('percentile', () => {
  it('uses nearest rank and handles an empty series', () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20)
    expect(percentile([10, 20, 30, 40], 95)).toBe(40)
    expect(percentile([], 50)).toBe(0)
  })
})

describe('summarizeNavSamples', () => {
  it('returns an empty summary rather than throwing when nothing was recorded', () => {
    expect(summarizeNavSamples([])).toEqual({
      sampleCount: 0,
      overall: null,
      warmCount: 0,
      coldCount: 0,
      settleTimedOutCount: 0,
      byRoute: [],
      slowest: [],
    })
  })

  it('splits warm from cold by whether the navigation had to fetch a payload', () => {
    const s = summarizeNavSamples([
      sample({ rscCount: 0, rscMs: 0 }),
      sample({ rscCount: 0, rscMs: 0 }),
      sample({ rscCount: 1, rscMs: 300 }),
    ])
    expect(s.warmCount).toBe(2)
    expect(s.coldCount).toBe(1)
  })

  it('ranks routes by median settle, slowest first', () => {
    const s = summarizeNavSamples([
      sample({ to: '/cardio', settleMs: 100 }),
      sample({ to: '/cardio', settleMs: 200 }),
      sample({ to: '/session-select', settleMs: 900 }),
    ])
    expect(s.byRoute.map(r => r.to)).toEqual(['/session-select', '/cardio'])
    expect(s.byRoute[1]).toMatchObject({ count: 2, medianSettleMs: 100, worstSettleMs: 200 })
  })

  it('summarises on settle, not paint — a skeleton route must not read as fast', () => {
    // Both navigations paint at 50ms; one keeps working for another 700ms behind a
    // loading.tsx skeleton. Ranking on paint would call them identical.
    const s = summarizeNavSamples([
      sample({ to: '/a', paintMs: 50, settleMs: 60 }),
      sample({ to: '/b', paintMs: 50, settleMs: 750 }),
    ])
    expect(s.byRoute[0].to).toBe('/b')
    expect(s.overall?.medianPaintMs).toBe(50)
    expect(s.overall?.worstSettleMs).toBe(750)
  })

  it('counts settle timeouts separately so a floor is never read as a measurement', () => {
    const s = summarizeNavSamples([
      sample({ settleMs: 100 }),
      sample({ settleMs: 6000, settleTimedOut: true }),
    ])
    expect(s.settleTimedOutCount).toBe(1)
    expect(s.sampleCount).toBe(2)
  })

  it('lists the five slowest navigations, worst first', () => {
    const s = summarizeNavSamples(
      [10, 900, 40, 700, 20, 300].map(settleMs => sample({ settleMs })),
    )
    expect(s.slowest.map(x => x.settleMs)).toEqual([900, 700, 300, 40, 20])
  })
})
