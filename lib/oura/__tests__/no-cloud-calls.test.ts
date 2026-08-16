// The Oura Cloud integration was removed on 2026-08-13 (owner: "get rid of oura cloud references we
// dont use it"). It cannot succeed: the ring has been on our own BLE auth key since the 2026-07-07
// re-key, so every Cloud request earns a 401 — and the obvious "fix", re-onboarding the official
// Oura app, risks a firmware update that breaks the reverse-engineered BLE protocol.
//
// That makes a re-added Cloud call a silent regression rather than a loud one: it compiles, it runs,
// it fails at the network, and the only evidence is a log line nobody reads. So the guard is a
// source-text sweep — the same shape as the decoder-constants and config-redirect checks, and for
// the same reason: the mistake lives in a string, which never crosses a typed boundary.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['app', 'components', 'lib', 'packages/shared/src']
const REPO = join(__dirname, '..', '..', '..')

// The Cloud host, the OAuth/PAT/webhook routes, and the two libs that held the HTTP client and the
// token cipher. `/api/oura/hr-*`, `/api/oura/workouts` and `/api/oura/stats` are deliberately absent
// from this list — they survive, and they read our own database despite the `/oura/` prefix.
const BANNED: Array<[RegExp, string]> = [
  [/api\.ouraring\.com/, 'the Oura Cloud API host'],
  [/cloud\.ouraring\.com/, 'the Oura Cloud console'],
  [/\/api\/oura\/sync/, 'the deleted Cloud sync route'],
  [/\/api\/oura\/token/, 'the deleted token route'],
  [/\/api\/oura\/connect/, 'the deleted OAuth connect route'],
  [/\/api\/oura\/callback/, 'the deleted OAuth callback route'],
  [/\/api\/oura\/webhook/, 'the deleted webhook receiver'],
  [/@\/lib\/oura\/client/, 'the deleted Oura HTTP client'],
  [/@\/lib\/oura\/token-crypto/, 'the deleted token cipher'],
]

// Files that may *name* the Cloud while making no call to it: the changelog is a historical record,
// cloud-freshness carries the re-key knowledge that explains why the Cloud is frozen, and the
// sync-provider guard has to spell out the route it is asserting the absence of.
const EXEMPT = new Set([
  'packages/shared/src/changelog.ts',
  'lib/oura/cloud-freshness.ts',
  'lib/oura/__tests__/cloud-freshness.test.ts',
  'components/__tests__/sync-provider-auth-gate.test.ts',
])

// Comment lines are excluded: this guard is about *calls*, and the history of why the Cloud went
// away is worth writing down next to the code it used to live in. Only whole-line comments are
// dropped — a string literal on a code line is still matched, which is where a real call would be.
function codeOf(src: string): string {
  return src
    .split('\n')
    .filter(line => {
      const t = line.trimStart()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
    .join('\n')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

describe('the Oura Cloud integration stays removed', () => {
  const files = ROOTS.flatMap(r => walk(join(REPO, r)))
    .map(f => f.slice(REPO.length + 1).replace(/\\/g, '/'))
    .filter(f => f !== 'lib/oura/__tests__/no-cloud-calls.test.ts' && !EXEMPT.has(f))

  // A sanity floor: if the walk silently stopped finding files, every assertion below would pass
  // vacuously and this guard would be worthless while looking green.
  it('sweeps the whole source tree', () => {
    expect(files.length).toBeGreaterThan(1000)
  })

  for (const [pattern, what] of BANNED) {
    it(`no source file reaches for ${what}`, () => {
      const hits = files.filter(f => pattern.test(codeOf(readFileSync(join(REPO, f), 'utf8'))))
      expect(hits).toEqual([])
    })
  }

  it('the repository exposes no Oura token storage', () => {
    const repo = readFileSync(join(REPO, 'lib/data/repository.ts'), 'utf8')
    for (const method of [
      'getOuraPat', 'saveOuraPat', 'deleteOuraPat', 'saveOuraOAuthTokens',
      'getOuraTokenRow', 'getUserIdByOuraUserId', 'saveWebhookSigningKey',
    ]) {
      expect(repo).not.toContain(method)
    }
  })
})
