// @vitest-environment jsdom
/**
 * issue 2152 — the "Heart after a dose" card in the vial sheet.
 *
 * The fixture has a KNOWN response built in, so each expected word is arithmetic on it: resting HR
 * +10 bpm on days 1-3 after every 1 mg dose against a tight pre-dose baseline (clear pattern), and
 * the same shape of +1 against a baseline that wobbles +/-8 (not clear: the middle half still
 * overlaps the person's normal).
 */
import { describe, it, expect, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { CATEGORICAL_PALETTE } from '@trainingai/shared/chart-colors'
import { recoveryResponse, metricPattern, type RecoveryDose, type RecoveryNight } from '../weight-response'
import { heartCardView, levelLabel } from '../heart-response-view'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const hoisted = vi.hoisted(() => ({ cached: null as unknown }))
vi.mock('@/lib/hooks/use-cached-value', () => ({ useCachedValue: () => hoisted.cached }))
vi.mock('@/components/shell/user-timezone-provider', () => ({ useUserTimezone: () => 'Australia/Brisbane' }))

import { HeartResponseBody, HeartResponseCard } from '../heart-response-card'

const TZ = 'Australia/Brisbane'
const SUB = 'sub-reta'
const START = '2026-08-01'

const dose = (date: string, amount: number, takenAt: string | null = null): RecoveryDose => ({
  supplementId: SUB, supplementName: 'Retatrutide', date, amount, unit: 'mg', doseText: null, takenAt,
})

/** Nights from START: pre-dose readings `pre(i)`, then base + `effect` on days 1-3 after a dose. */
function build(doseDates: string[], pre: (i: number) => number, effect: number, days = 60): RecoveryNight[] {
  return Array.from({ length: days }, (_, i) => {
    const date = shiftDateStr(START, i)
    if (date < doseDates[0]) return { date, restingHr: 50 + pre(i), hrvMs: 60 - pre(i) }
    const last = [...doseDates].filter(d => d <= date).pop() as string
    const since = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000)
    const hit = since >= 1 && since <= 3
    return { date, restingHr: 50 + (hit ? effect : 0), hrvMs: 60 - (hit ? effect * 2 : 0) }
  })
}

const MG1 = ['2026-08-20', '2026-08-27', '2026-09-03', '2026-09-10']
const tight = (i: number) => (i % 3) - 1 // 49 / 50 / 51
const loose = (i: number) => ([-8, -4, 0, 4, 8][i % 5]) // IQR 8

const render = (doses: RecoveryDose[], nights: RecoveryNight[]) => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(createElement(HeartResponseBody, { doses, nights, tz: TZ })) })
  return { host, unmount: () => { act(() => root.unmount()); host.remove() } }
}

describe('heartCardView states', () => {
  it('under 2 doses reads Not enough yet, with no chart and no sentence', () => {
    const doses = [dose('2026-08-20', 1)]
    const lvl = recoveryResponse({ doses, nights: build(['2026-08-20'], tight, 10), tz: TZ })[0].levels[0]
    const v = heartCardView(lvl)
    expect(v.state).toBe('not_enough')
    expect(v.chip).toBe('Not enough yet')
    expect(v.sentence).toBeNull()
    expect(v.charts).toEqual([])
    expect(v.subtitle).toBe('1 mg · 1 dose')
  })

  it('a middle half fully outside the normal on some day is a Clear pattern, with one plain sentence', () => {
    const doses = MG1.map(d => dose(d, 1))
    const lvl = recoveryResponse({ doses, nights: build(MG1, tight, 10), tz: TZ })[0].levels[0]
    expect(metricPattern(lvl.rhr).clear).toBe(true)
    const v = heartCardView(lvl)
    expect(v.state).toBe('clear')
    expect(v.chip).toBe('Clear pattern')
    expect(v.sentence).toContain('Your resting HR climbs to about 60')
    expect(v.sentence).toContain('your normal is 50')
    expect(v.sentence).toContain('HRV drops to about 40 ms')
    expect(v.subtitle).toBe('1 mg · 4 doses')
  })

  it('a middle half that still overlaps the normal is No clear pattern yet, and prints no sentence', () => {
    const doses = MG1.map(d => dose(d, 1))
    const lvl = recoveryResponse({ doses, nights: build(MG1, loose, 1), tz: TZ })[0].levels[0]
    expect(metricPattern(lvl.rhr).clear).toBe(false)
    const v = heartCardView(lvl)
    expect(v.state).toBe('no_clear_pattern')
    expect(v.chip).toBe('No clear pattern yet')
    expect(v.sentence).toBeNull()
    expect(v.charts.length).toBe(2) // the line is still drawn
  })

  it('never words a cause', () => {
    const doses = MG1.map(d => dose(d, 1))
    const lvl = recoveryResponse({ doses, nights: build(MG1, tight, 10), tz: TZ })[0].levels[0]
    const v = heartCardView(lvl)
    const copy = [v.sentence, v.chip, v.subtitle].join(' ')
    expect(copy).not.toMatch(/\b(because|caused?|due to|result of|effect of|leads? to|reta(trutide)? (raises|lowers|makes))\b/i)
  })

  it('labels a dose with no amount by its text, or says so', () => {
    expect(levelLabel({ amount: 0.5, unit: 'mg', doseText: null })).toBe('0.5 mg')
    expect(levelLabel({ amount: null, unit: null, doseText: '2 capsules' })).toBe('2 capsules')
    expect(levelLabel({ amount: null, unit: null, doseText: null })).toBe('Amount not stated')
  })
})

describe('HeartResponseBody (jsdom)', () => {
  it('one section per dose amount, never pooled, newest amount first', () => {
    const dates = ['2026-08-13', ...MG1]
    const doses = [dose('2026-08-13', 0.5), ...MG1.map(d => dose(d, 1))]
    const { host, unmount } = render(doses, build(dates, tight, 10))
    const sections = host.querySelectorAll('[data-testid="heart-response-section"]')
    expect(sections.length).toBe(2)
    expect(sections[0].textContent).toContain('1 mg · 4 doses')
    expect(sections[0].textContent).toContain('Clear pattern')
    expect(sections[1].textContent).toContain('0.5 mg · 1 dose')
    expect(sections[1].textContent).toContain('Not enough yet')
    expect(sections[1].querySelector('svg')).toBeNull()
    unmount()
  })

  it('draws day labels dose, d1 ... d6 and two single-series charts', () => {
    const { host, unmount } = render(MG1.map(d => dose(d, 1)), build(MG1, tight, 10))
    const svgs = host.querySelectorAll('svg')
    expect(svgs.length).toBe(2)
    const labels = [...svgs[0].querySelectorAll('text')].map(t => t.textContent)
    for (const l of ['dose', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6']) expect(labels).toContain(l)
    expect(svgs[0].querySelectorAll('[data-testid="median-line"]').length).toBe(1)
    expect(svgs[0].querySelectorAll('[data-testid="middle-half"]').length).toBe(1)
    expect(svgs[0].querySelectorAll('[data-testid="normal-strip"]').length).toBe(1)
    unmount()
  })

  it('draws the series in the first categorical colour, never a verdict colour', () => {
    const { host, unmount } = render(MG1.map(d => dose(d, 1)), build(MG1, tight, 10))
    const line = host.querySelector('[data-testid="median-line"]') as SVGElement
    expect(line.getAttribute('stroke')).toBe(CATEGORICAL_PALETTE[0])
    unmount()
  })

  it('renders nothing when the supplement has no doses', () => {
    const { host, unmount } = render([], build(MG1, tight, 10))
    expect(host.innerHTML).toBe('')
    unmount()
  })
})

describe('HeartResponseCard', () => {
  it('paints nothing, and no skeleton, until it has data', () => {
    hoisted.cached = null
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => { root.render(createElement(HeartResponseCard, { supplementId: SUB })) })
    expect(host.innerHTML).toBe('')
    act(() => root.unmount())
  })

  it('paints from the cached value on first render', () => {
    hoisted.cached = { doses: MG1.map(d => dose(d, 1)), nights: build(MG1, tight, 10) }
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => { root.render(createElement(HeartResponseCard, { supplementId: SUB })) })
    expect(host.textContent).toContain('Heart after a dose')
    act(() => root.unmount())
  })
})

describe('source rules', () => {
  const src = readFileSync(path.join(__dirname, '..', 'heart-response-card.tsx'), 'utf8')
  it('adds no hex colour literal and no verdict colour', () => {
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(src).not.toMatch(/\b(red|green|amber|emerald)-\d{3}\b/)
  })
})
