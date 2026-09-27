// A migration number is reserved by the branch holding the file, and an open PR's file is not in
// the merged tree. `ls lib/data/postgres/migrations/ | tail -1` therefore hands the next author a
// number that is already spoken for — which is #1608, where an outside contributor derived 284/285
// from what they could see and a branch carrying the same pair merged first (issue #1620, BF-211).
//
// These pin the part a filename cannot answer: which numbers a branch is holding, and which are
// claimed twice.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GRANDFATHERED, claimsFromFiles, surveyClaims } = require('../lib/migration-claims.js') as {
  GRANDFATHERED: Set<string>
  claimsFromFiles: (files: string[]) => Map<string, string[]>
  surveyClaims: (
    merged: string[],
    branches: { ref: string; files: string[] }[],
  ) => {
    next: string
    reserved: { num: string; ref: string; file: string }[]
    collisions: { num: string; claims: string[] }[]
  }
}

const merged = ['284_sleep_verdicts.sql', '285_claude_ro_views_sleep_verdicts.sql']

describe('surveyClaims', () => {
  it('counts a branch-held number, so the next one clears it', () => {
    // The shape on 2026-09-27: 286/287 held by an unmerged PR, nothing merged above 285.
    const r = surveyClaims(merged, [
      { ref: 'origin/la142', files: ['286_drop_dead.sql', '287_claude_ro_views_drop.sql'] },
    ])
    expect(r.next).toBe('288')
    expect(r.reserved.map((x) => x.num)).toEqual(['286', '287'])
  })

  it('derives 286 from the merged tree alone — the number the branch is using', () => {
    // The control: the same repository, asked the way the removed pointer asked it.
    expect(surveyClaims(merged, []).next).toBe('286')
  })

  it('names both sides of a live collision', () => {
    const r = surveyClaims(merged, [
      { ref: 'origin/health-sample-storage', files: ['284_apple_health_samples.sql'] },
    ])
    expect(r.collisions).toEqual([
      {
        num: '284',
        claims: ['merged: 284_sleep_verdicts.sql', 'origin/health-sample-storage: 284_apple_health_samples.sql'],
      },
    ])
  })

  it('does not report a branch that simply contains the merged file', () => {
    const r = surveyClaims(merged, [{ ref: 'origin/up-to-date', files: [...merged] }])
    expect(r.reserved).toEqual([])
    expect(r.collisions).toEqual([])
  })

  it('does not call one migration on two branches a collision', () => {
    // A branch cut from another carries the same file. Two claims, one filename — the number is
    // spoken for once, by one migration. Comparing claim COUNT rather than filename reports this
    // as a clash and sends someone to renumber a file that is already correct.
    const r = surveyClaims(merged, [
      { ref: 'origin/feature', files: ['286_thing.sql'] },
      { ref: 'origin/feature-followup', files: ['286_thing.sql'] },
    ])
    expect(r.collisions).toEqual([])
    expect(r.next).toBe('287')
  })

  it('stays quiet about the four duplicates already applied to production', () => {
    // check-migration-numbers.js shares this set: renaming an applied migration re-runs it.
    const files = ['081_exercise_library_expand.sql', '081_exercise_media.sql']
    expect([...GRANDFATHERED]).toContain('081')
    expect(surveyClaims(files, []).collisions).toEqual([])
  })

  it('keeps the zero padding the directory uses', () => {
    expect(surveyClaims(['009_a.sql'], []).next).toBe('010')
  })

  it('ignores a filename with no numeric prefix', () => {
    expect([...claimsFromFiles(['README.md', 'draft_thing.sql', '012_real.sql']).keys()]).toEqual(['012'])
  })
})
