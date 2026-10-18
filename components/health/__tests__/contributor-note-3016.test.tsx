// @vitest-environment jsdom
/**
 * issue 3016 — `provisional` has three senses, and the contributor detail printed the baseline note for
 * all of them. The note now follows the case (`contributorNote`), so an input that is not learning a
 * baseline no longer says it is.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ContributorDetail } from '../contributor-detail'
import { PROVISIONAL_BASELINE_NOTE, OURA_CONTRIBUTOR_NOTE, APPROXIMATE_CURVE_NOTE, SCORE_GAP_TEXT } from '@trainingai/shared/health/score-gap-copy'

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null })

function text(props: { score: number; provisional: boolean; gap?: unknown; scale?: unknown }) {
  const el = document.createElement('div')
  root = createRoot(el)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  act(() => root!.render(createElement(ContributorDetail, { contributorKey: 'hrvBalance', ...props })))
  return el.textContent ?? ''
}

describe('ContributorDetail note by case', () => {
  it('prints the baseline note only while learning', () => {
    expect(text({ score: 50, provisional: true, gap: 'awaiting_baseline' })).toContain(PROVISIONAL_BASELINE_NOTE)
  })
  it('prints the gap text when nothing was recorded', () => {
    const out = text({ score: 50, provisional: true, gap: 'no_input' })
    expect(out).toContain(SCORE_GAP_TEXT.no_input)
    expect(out).not.toContain(PROVISIONAL_BASELINE_NOTE)
  })
  it("explains Oura's own reading, and the overnight-HR estimate", () => {
    const oura = text({ score: 72, provisional: true, gap: null, scale: 'oura_contributor' })
    expect(oura).toContain(OURA_CONTRIBUTOR_NOTE)
    expect(oura).not.toContain(PROVISIONAL_BASELINE_NOTE)
    const curve = text({ score: 64, provisional: true, gap: null })
    expect(curve).toContain(APPROXIMATE_CURVE_NOTE)
    expect(curve).not.toContain(PROVISIONAL_BASELINE_NOTE)
  })
})
