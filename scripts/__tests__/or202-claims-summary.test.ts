// OR-202 — next-schema-number's report, made readable: identical claims collapse to one line, and the
// deleted `claude_ro_views` pattern is not a claim at all. Before this a run printed 470 KB and the
// one real collision in it could not be seen.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { surveyClaims, summariseClaims, refList } = require('../lib/migration-claims.js')

const merged = ['273_exercise_media_review_status.sql', '274_claude_ro_views_exercise_media_review.sql', '296_x.sql']
const stale = (ref: string) => ({ ref, files: ['274_claude_ro_views_exercise_media_review.sql', '142_claude_ro_views.sql'] })

describe('summariseClaims (OR-202)', () => {
  it('drops the dead claude_ro_views pattern, counting the stale branches that hold it', () => {
    const survey = surveyClaims(merged.filter(f => !f.includes('claude_ro')), [stale('origin/a'), stale('origin/b'), stale('origin/c')])
    const out = summariseClaims(survey)
    expect(out.reserved).toEqual([])
    expect(out.collisions).toEqual([])
    expect(out.deadRefs).toBe(3)
  })

  it('collapses one file held by many branches into one line', () => {
    const branches = ['origin/a', 'origin/b', 'origin/c'].map(ref => ({ ref, files: ['297_same.sql'] }))
    const out = summariseClaims(surveyClaims(merged, branches))
    expect(out.reserved).toEqual([{ num: '297', file: '297_same.sql', refs: ['origin/a', 'origin/b', 'origin/c'] }])
  })

  it('keeps a real collision, grouped by file, and it survives beside the noise', () => {
    const branches = [
      stale('origin/a'), stale('origin/b'),
      { ref: 'origin/q44', files: ['273_vendor_table_rename_phase_3.sql'] },
    ]
    const out = summariseClaims(surveyClaims(merged, branches))
    expect(out.collisions).toEqual([{
      num: '273',
      files: [
        { file: '273_exercise_media_review_status.sql', refs: ['merged'] },
        { file: '273_vendor_table_rename_phase_3.sql', refs: ['origin/q44'] },
      ],
    }])
  })

  it('a collision whose only other claimant is the dead pattern is not a collision', () => {
    const branches = [{ ref: 'origin/a', files: ['142_claude_ro_views.sql'] }, { ref: 'origin/b', files: ['142_claude_ro_views_other.sql'] }]
    expect(summariseClaims(surveyClaims(['296_x.sql'], branches)).collisions).toEqual([])
  })

  it('nor is a live migration whose number a stale branch reuses for the dead pattern', () => {
    const branches = [{ ref: 'origin/stale', files: ['290_claude_ro_views_apple.sql'] }]
    const survey = surveyClaims(['290_apple_health_samples.sql'], branches)
    expect(survey.collisions).toHaveLength(1)
    expect(summariseClaims(survey).collisions).toEqual([])
  })
})

describe('refList (OR-202)', () => {
  it('names two and counts the rest', () => {
    expect(refList(['a', 'b'])).toBe('a, b')
    expect(refList(['a', 'b', 'c', 'd'])).toBe('a, b +2 more')
  })
})
