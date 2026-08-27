// Q-407 — what a multi-select answer looks like when it re-enters the model's context.
//
// `WidgetResultSchema` says the result "should read like something the user said rather than a
// serialised event", and this is the only place that claim is enforceable. It also has the one
// off-by-one in the feature: the join slices off the last label and reattaches it.
import { describe, it, expect } from 'vitest'
import { joinChoiceLabels } from '../choice-label'

describe('joinChoiceLabels', () => {
  it('reads as speech at each length', () => {
    expect(joinChoiceLabels(['Coles'])).toBe('Coles')
    expect(joinChoiceLabels(['Coles', 'Aldi'])).toBe('Coles and Aldi')
    expect(joinChoiceLabels(['Coles', 'Aldi', 'IGA'])).toBe('Coles, Aldi and IGA')
    expect(joinChoiceLabels(['Coles', 'Aldi', 'IGA', 'Costco']))
      .toBe('Coles, Aldi, IGA and Costco')
  })

  // The slice is `slice(0, -1)` and the tail is `[length - 1]`. Off by one either way and a label
  // is silently dropped or repeated — in a sentence the model then treats as the user's answer.
  it('never drops or repeats a label', () => {
    for (let n = 1; n <= 8; n++) {
      const labels = Array.from({ length: n }, (_, i) => `S${i}`)
      const out = joinChoiceLabels(labels)
      for (const l of labels) expect(out, `n=${n}`).toContain(l)
      expect(out.split(/,\s|\sand\s/), `n=${n}`).toHaveLength(n)
    }
  })

  it('is empty for nothing chosen, rather than the word "and"', () => {
    expect(joinChoiceLabels([])).toBe('')
  })
})
