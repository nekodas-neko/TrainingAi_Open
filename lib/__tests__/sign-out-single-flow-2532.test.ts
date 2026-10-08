/**
 * Issue 2532: every sign-out goes through the unsynced-changes flow. A new caller of
 * `signOutAndClearDevice` would sign out without the sync-first warning, so only these may import it.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SKIP = new Set(['node_modules', '.next', '.git', 'android', 'ios', 'out', 'dist', '.claude'])
const ALLOWED = new Set([
  'components/more/sign-out-flow.tsx',   // the flow: "Sign out anyway" and a clean sync
  'lib/sign-out.ts',                     // the definition
  'lib/account/delete-account.ts',       // deletion's own server-first sign-out, after the sheet's prepare step
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('issue 2532 sign-out callers', () => {
  it('only the shared flow, the definition and account deletion import signOutAndClearDevice', () => {
    const offenders = walk(ROOT)
      .map(f => relative(ROOT, f).split(sep).join('/'))
      .filter(rel => !rel.includes('__tests__') && !/\.test\.tsx?$/.test(rel) && !ALLOWED.has(rel))
      .filter(rel => /import[^;]*\bsignOutAndClearDevice\b[^;]*from/.test(readFileSync(join(ROOT, rel), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the profile Sign Out button and the delete sheet use the flow', () => {
    const profile = readFileSync(join(ROOT, 'components/more/profile-tab.tsx'), 'utf8')
    expect(profile).toMatch(/useSignOutFlow\(/)
    const sheet = readFileSync(join(ROOT, 'components/more/delete-account-sheet.tsx'), 'utf8')
    expect(sheet).toMatch(/prepareAccountDeletion\(/)
  })
})
