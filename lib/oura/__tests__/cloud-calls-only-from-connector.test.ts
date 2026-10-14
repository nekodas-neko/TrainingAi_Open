// Oura Cloud calls come from one module only: the connector, `lib/oura/cloud/` (#2858).
//
// History: the Cloud integration was removed on 2026-08-13, when the ring was on our own BLE key and
// every Cloud request could only 401, and this guard's predecessor (`no-cloud-calls.test.ts`) banned
// Cloud calls everywhere. On 2026-10-11 the owner moved the ring's source to the Oura Cloud API
// (#2808), built as a pluggable connector. The guard now keeps that connector the one door: tokens
// are decrypted there, refreshes are single-flight there, and a stray `fetch` to Oura elsewhere would
// bypass both.
//
// A source-text sweep, as before, because the mistake lives in a string (a host name) that never
// crosses a typed boundary.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['app', 'components', 'lib', 'packages/shared/src', 'mobile/src']
// Root-level config and entrypoints, which the directories above do not reach. The CSP used to live
// in `next.config.ts` and kept `connect-src` open to both Oura hosts for a week after the integration
// was deleted (2026-08-20, Q-546). The browser never talks to Oura: the consent page is a top-level
// redirect, and every API call is made by the server.
const ROOT_FILES = ['next.config.ts', 'auth.ts', 'middleware.ts', 'instrumentation.ts', 'instrumentation-node.ts']
const REPO = join(__dirname, '..', '..', '..')

/** The connector. Everything under it may name and call Oura Cloud. */
const CONNECTOR_DIR = 'lib/oura/cloud/'

const OURA_HOSTS = /\b(?:api|cloud)\.ouraring\.com\b/

// Files outside the connector that may name an Oura host while calling nothing: the changelog is a
// historical record.
const EXEMPT = new Set(['packages/shared/src/changelog.ts'])

// Whole-line comments are dropped: this guard is about calls, and a comment that explains where the
// Cloud went and came back is worth keeping next to the code. A string on a code line is still
// matched, which is where a real call would be.
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
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === '__check_fixture__' || name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(full)
  }
  return out
}

const SELF = 'lib/oura/__tests__/cloud-calls-only-from-connector.test.ts'

describe('Oura Cloud is reached only through the connector module', () => {
  const files = [...ROOTS.flatMap(r => walk(join(REPO, r))), ...ROOT_FILES.map(f => join(REPO, f)).filter(existsSync)]
    .map(f => f.slice(REPO.length + 1).replace(/\\/g, '/'))
    .filter(f => f !== SELF)

  // A sanity floor: if the walk silently stopped finding files, every assertion below would pass
  // vacuously and this guard would be worthless while looking green.
  it('sweeps the whole source tree, connector included', () => {
    expect(files.length).toBeGreaterThan(1000)
    for (const f of ROOT_FILES) expect(files, `${f} is no longer being swept`).toContain(f)
    for (const f of ['config.ts', 'client.ts', 'tokens.ts', 'token-cipher.ts']) {
      expect(files, `${CONNECTOR_DIR}${f} has moved; update this guard`).toContain(`${CONNECTOR_DIR}${f}`)
    }
  })

  it('no file outside lib/oura/cloud/ names an Oura Cloud host', () => {
    const hits = files
      .filter(f => !f.startsWith(CONNECTOR_DIR) && !EXEMPT.has(f))
      .filter(f => OURA_HOSTS.test(codeOf(readFileSync(join(REPO, f), 'utf8'))))
    expect(hits).toEqual([])
  })

  it('the connector itself does name them (the guard is pointed at the right place)', () => {
    expect(OURA_HOSTS.test(codeOf(readFileSync(join(REPO, CONNECTOR_DIR, 'config.ts'), 'utf8')))).toBe(true)
  })

  // The HTTP client is the connector's inside. Code elsewhere goes through `tokens.ts`, which owns
  // decryption and the single-flight refresh; calling the client directly would skip both.
  it('only the connector imports its HTTP client', () => {
    const hits = files
      .filter(f => !f.startsWith(CONNECTOR_DIR))
      .filter(f => /['"]@\/lib\/oura\/cloud\/client['"]/.test(readFileSync(join(REPO, f), 'utf8')))
    expect(hits).toEqual([])
  })

  it('the data layer never sees a plaintext token: the slice takes only the cipher type', () => {
    const slice = readFileSync(join(REPO, 'lib/data/postgres/slices/oura-cloud-tokens.ts'), 'utf8')
    expect(slice).toMatch(/accessToken: EncryptedOuraToken\b/)
    expect(slice).toMatch(/refreshToken: EncryptedOuraToken\b/)
    expect(slice).toMatch(/import type \{ EncryptedOuraToken \} from '@\/lib\/oura\/cloud\/token-cipher'/)
    expect(slice).not.toMatch(/\b(?:en|de)cryptOuraToken\b/)
  })
})
