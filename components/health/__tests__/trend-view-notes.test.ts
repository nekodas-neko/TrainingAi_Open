/**
 * #2829 — the meal-timing view says what its meal time is. The sentence lives once in
 * packages/shared; both Trends cards (web and the native Progress panel) must read it from there.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TREND_VIEW_NOTE } from '@trainingai/shared/health/trend-view-notes'

const root = join(__dirname, '..', '..', '..')
const surfaces = [
  'components/health/trends-section.tsx',
  'mobile/src/features/health/components/ProgressPanel.tsx',
]

describe('TREND_VIEW_NOTE', () => {
  it('has a note for meal-timing', () => {
    expect(TREND_VIEW_NOTE['meal-timing']).toMatch(/when you said you ate/)
  })

  it.each(surfaces)('%s renders the shared note', (file) => {
    const src = readFileSync(join(root, file), 'utf8')
    expect(src).toContain('@trainingai/shared/health/trend-view-notes')
    expect(src).toMatch(/TREND_VIEW_NOTE\[view\]/)
  })
})
