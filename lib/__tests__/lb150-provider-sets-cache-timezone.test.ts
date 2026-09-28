// LB-150 — the "today" cache envelope judges freshness by `setCacheTimezone`'s value, and the only
// thing that sets it is `UserTimezoneProvider`. Both vitest projects run in `node` with no JSX
// transform, so the provider cannot be rendered here (see bf177-balance-subscribes); this pins the
// link in its source instead, with comments stripped so a mention cannot pass for a call.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'

const code = stripComments(readFileSync(path.resolve(__dirname, '../../components/shell/user-timezone-provider.tsx'), 'utf8'))

describe('UserTimezoneProvider hands the timezone to the cache (LB-150)', () => {
  it('imports setCacheTimezone and calls it with the timezone', () => {
    expect(code).toMatch(/import\s*\{[^}]*\bsetCacheTimezone\b[^}]*\}\s*from\s*['"]@\/lib\/sqlite\/cache['"]/)
    expect(code).toMatch(/\bsetCacheTimezone\(\s*timezone\s*\)/)
  })

  it('calls it in the render body, not inside an effect that would run after the children', () => {
    const body = code.slice(code.indexOf('export function UserTimezoneProvider'), code.indexOf('export function useUserTimezone'))
    expect(body).toMatch(/setCacheTimezone\(\s*timezone\s*\)/)
    expect(body).not.toMatch(/useEffect|useLayoutEffect/)
  })
})
