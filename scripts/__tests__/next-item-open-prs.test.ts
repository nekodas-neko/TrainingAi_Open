// An entry with an open PR must not read as untouched work. A Lane A session rebuilt six security
// fixes on 2026-09-28/29 because `next-item.js` listed them as READY while their PRs sat open.
import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { matchOpenPrs } = require('../lib/open-prs')

const prs = [
  { number: 1672, title: 'RV-190 — the read-only endpoint leaked session state', headRefName: 'lane-a/rv190-db-query-session-state' },
  { number: 1755, title: 'OR-159 + RV-196: keep the session cookie out of backup', headRefName: 'lane-a/native-security-batch' },
  { number: 1930, title: 'Something unrelated', headRefName: 'security/rv195-auth-social-gaps' },
  { number: 1, title: 'Fix RV-1900 and LA-14a', headRefName: 'fix/misc' },
]

describe('matchOpenPrs', () => {
  it('finds an id in a PR title or in its branch name', () => {
    const m = matchOpenPrs(['RV-190', 'RV-196', 'OR-159', 'RV-195'], prs)
    expect(m.get('RV-190')).toEqual([1672])
    expect(m.get('RV-196')).toEqual([1755])
    expect(m.get('OR-159')).toEqual([1755])
    expect(m.get('RV-195')).toEqual([1930])
  })

  it('never lets a shorter id claim a longer one, in either place', () => {
    const m = matchOpenPrs(['RV-19', 'RV-1', 'LA-14', 'RV-1900', 'LA-14a'], prs)
    expect(m.has('RV-19')).toBe(false)
    expect(m.has('RV-1')).toBe(false)
    expect(m.has('LA-14')).toBe(false)
    expect(m.get('RV-1900')).toEqual([1])
    expect(m.get('LA-14a')).toEqual([1])
  })
})
