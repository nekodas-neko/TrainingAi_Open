import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
/** Both files explain the defaulting bug in prose, so a raw match would pass on the comment. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/**
 * LB-113 — the Health Connect sync takes the user's timezone and nothing passed it.
 *
 * `syncHealthConnect(tz = DEFAULT_TZ)` and `enrichActivityLogs(candidates, tz = DEFAULT_TZ)` gained
 * the parameter on 2026-09-16; every caller kept using the default. Brisbane is right for the owner
 * and wrong for anyone else, and a default that every caller is supposed to override is exactly the
 * shape CLAUDE.md names as what makes forgetting silent.
 */
describe('LB-113 — every Health Connect entry point is given a timezone', () => {
  it('the provider passes the user timezone rather than taking the default', () => {
    const provider = code('components/health-connect-provider.tsx')
    expect(provider).toContain('useUserTimezone()')
    expect(provider).toContain('syncHealthConnect(tz)')
    expect(provider, 'the bare call is what defaulted to Brisbane').not.toContain('syncHealthConnect()')
  })

  it('and re-runs if that timezone changes, rather than pinning the first one', () => {
    // A `[]` dependency array would capture whatever tz was current at mount. The provider is inside
    // UserTimezoneProvider, which is server-fed, so there is no placeholder flip to double-sync on.
    expect(code('components/health-connect-provider.tsx')).toContain('}, [tz])')
  })

  it('the INTERNAL enrichment call threads it too — the half the entry did not name', () => {
    // `enrichActivityLogs` is called from inside `syncHealthConnect`, not from the component. The
    // entry said "two call sites in one component"; the second is here, and it is the one that would
    // have kept bucketing in Brisbane however carefully the component was fixed.
    expect(code('lib/health-connect-sync.ts')).toContain('enrichActivityLogs(enrichmentCandidates, tz)')
  })

  it('no entry point is reached without one — the entry\'s own pass test', () => {
    const sources = ['components/health-connect-provider.tsx', 'lib/health-connect-sync.ts']
      .map(code).join('\n')
    // The call with no argument at all, in either file. `export ... function` declarations carry the
    // parameter list, so they cannot match.
    expect(sources).not.toMatch(/(?<!function )\bsyncHealthConnect\(\s*\)/)
    expect(sources).not.toMatch(/\benrichActivityLogs\(\s*[A-Za-z]+\s*\)/)
  })

  it('leaves the defaults in place, because they are the server-side contract', () => {
    // The parameters keep `= DEFAULT_TZ`: removing them would make this a breaking signature change
    // for a module Lane A owns, and the defect is the callers, not the defaults.
    const sync = read('lib/health-connect-sync.ts')
    expect(sync).toContain('tz: string = DEFAULT_TZ')
  })
})
