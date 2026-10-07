/**
 * RV-179 / Q-252 — Sentry events carry the deploy that produced them.
 *
 * The SDK auto-detects a release from the environment or git HEAD, and the release workflow ships
 * with `railway up` (no git history, no `RAILWAY_GIT_COMMIT_SHA`), so on the path that matters events
 * had none. `package@version+build` is Sentry's own convention. The same string has to reach three
 * runtimes (browser, server, edge) and the build plugin's source-map upload, or a stack trace and
 * its release come apart.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sentryRelease } from '../sentry-release'
import { readAppVersion } from '../app-version'

const root = join(__dirname, '..', '..', '..')
const src = (p: string) => readFileSync(join(root, p), 'utf8')

describe('sentryRelease', () => {
  it('joins the package version and the build sha in Sentry’s package@version+build form', () => {
    expect(sentryRelease('1.489.0', 'abc123def456')).toBe('trainingai@1.489.0+abc123def456')
  })

  it('is the version alone when there is no build sha — a local build, not a made-up one', () => {
    expect(sentryRelease('1.489.0', '')).toBe('trainingai@1.489.0')
    expect(sentryRelease('1.489.0', undefined)).toBe('trainingai@1.489.0')
    expect(sentryRelease('1.489.0', '   ')).toBe('trainingai@1.489.0')
  })

  it('is undefined with no version, so an event is untagged rather than tagged with nonsense', () => {
    expect(sentryRelease(undefined, 'abc123')).toBeUndefined()
    expect(sentryRelease('', 'abc123')).toBeUndefined()
  })

  it('tells a hotfix from the release it patched: same version, different build', () => {
    expect(sentryRelease('1.489.0', 'aaaaaaaaaaaa')).not.toBe(sentryRelease('1.489.0', 'bbbbbbbbbbbb'))
  })
})

describe('readAppVersion', () => {
  it('reads package.json’s version, which is the one a release bumps', () => {
    const real = (JSON.parse(src('package.json')) as { version: string }).version
    expect(readAppVersion(root)).toBe(real)
    expect(real).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('is null when it cannot be read, never a throw at build time', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ver-'))
    try {
      expect(readAppVersion(dir)).toBeNull()
      writeFileSync(join(dir, 'package.json'), '{ not json')
      expect(readAppVersion(dir)).toBeNull()
      writeFileSync(join(dir, 'package.json'), '{"version": 3}')
      expect(readAppVersion(dir)).toBeNull()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('the edge runtime can load the release helper', () => {
  // The first build of this failed with `Can't resolve 'fs'` because `sentry.edge.config.ts` imports
  // the helper and the helper imported Node. A source test is the cheapest thing that holds it: the
  // build is what proves it, and it takes five minutes.
  it('sentry-release.ts imports nothing from Node', () => {
    const s = src('lib/observability/sentry-release.ts')
    expect(s).not.toMatch(/from\s+["'](?:node:)?(?:fs|path|os|child_process|crypto)["']/)
    expect(s).not.toMatch(/\brequire\(/)
  })

  it('and the Node-only reader is not imported by any Sentry init', () => {
    for (const f of ['instrumentation-client.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts']) {
      expect(src(f), f).not.toContain('app-version')
    }
  })
})

describe('the release reaches every place it has to', () => {
  const INIT_FILES = ['instrumentation-client.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts']

  it.each(INIT_FILES)('%s tags events from the two values next.config bakes in', file => {
    const s = src(file)
    expect(s).toContain("from '@/lib/observability/sentry-release'")
    // Written as literal `process.env.NEXT_PUBLIC_*` reads, because that is the only form Next inlines.
    expect(s).toMatch(/release:\s*sentryRelease\(process\.env\.NEXT_PUBLIC_APP_VERSION,\s*process\.env\.NEXT_PUBLIC_BUILD_ID\)/)
  })

  it('next.config bakes both values in, and names the same release for the source-map upload', () => {
    const s = src('next.config.ts')
    expect(s).toMatch(/NEXT_PUBLIC_APP_VERSION:\s*readAppVersion\(\)/)
    expect(s).toMatch(/NEXT_PUBLIC_BUILD_ID:\s*readBuildSha\(\)/)
    expect(s).toMatch(/release:\s*\{\s*name:\s*sentryRelease\(readAppVersion\(\) \?\? undefined, readBuildSha\(\)\?\.slice\(0, 12\)\)/)
  })

  it('the upload creates a release only when there is a token to create it with', () => {
    expect(src('next.config.ts')).toMatch(/create:\s*!!process\.env\.SENTRY_AUTH_TOKEN/)
  })

  it('still has no session replay: that was decided against, in writing, and is not re-opened here', () => {
    for (const f of INIT_FILES) expect(src(f)).not.toMatch(/replayIntegration|replaysSessionSampleRate|replaysOnErrorSampleRate/)
  })
})
