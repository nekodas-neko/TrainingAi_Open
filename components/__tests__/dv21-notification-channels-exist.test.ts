import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments } from '../../scripts/lib/strip-comments.js'

/**
 * DV-21 — every channel the app schedules to must be one the app creates.
 *
 * `lib/health-alerts.ts` scheduled to `health-alerts` for the whole life of the feature and
 * `capacitor-native-init.tsx` created five channels, none of them that one. **On Android 8+ a post
 * to a channel that does not exist is dropped by the system with no error**, so illness, high-stress
 * and low-readiness alerts could never appear — while `computeHealthAlertActions` passed its unit
 * tests, `reconcileHealthAlerts` ran on every sync and the dedup key was written. Every layer above
 * the channel looked healthy, and the only surface that showed the fault was the device's own
 * channel list, which is why it took a phone in someone's hand to find.
 *
 * This is the source-level surface that was missing. It deliberately compares the *identifiers*,
 * because that is how both sides are written — a literal on one side and a constant on the other
 * would be a separate defect worth failing on.
 */
const ROOTS = ['app', 'components', 'lib', 'packages']
const CODE = /\.tsx?$/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // `__tests__` is skipped so this file's own failure messages, which name the pattern it
    // looks for, are not read back as call sites.
    if (name === 'node_modules' || name === 'dist' || name === '.next' || name === '__tests__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (CODE.test(name)) out.push(full)
  }
  return out
}

const repoRoot = join(__dirname, '..', '..')
const sources = ROOTS.flatMap(r => walk(join(repoRoot, r)))
  .map(f => ({ file: f.slice(repoRoot.length + 1), code: stripComments(readFileSync(f, 'utf8')) as string }))

const TOKEN = String.raw`([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")`

function matches(re: RegExp): { file: string; id: string }[] {
  const found: { file: string; id: string }[] = []
  for (const { file, code } of sources) {
    for (const m of code.matchAll(re)) found.push({ file, id: m[1] })
  }
  return found
}

describe('DV-21 — notification channels', () => {
  const scheduled = matches(new RegExp(String.raw`channelId:\s*${TOKEN}`, 'g'))
  const created = matches(new RegExp(String.raw`createChannel\(\{[\s\S]*?\bid:\s*${TOKEN}`, 'g'))

  it('finds both sides, or the scan proves nothing', () => {
    expect(scheduled.length, 'no channelId: sites found — the scan is broken, not the app').toBeGreaterThan(0)
    expect(created.length, 'no createChannel sites found — the scan is broken, not the app').toBeGreaterThan(0)
  })

  it('every channel the app schedules to is one it creates', () => {
    const ids = new Set(created.map(c => c.id))
    const orphans = scheduled.filter(s => !ids.has(s.id))
    expect(orphans, `scheduled to a channel nothing creates — Android drops the post silently. Created: ${[...ids].join(', ')}`)
      .toEqual([])
  })

  it('health-alerts in particular is created', () => {
    expect(created.map(c => c.id)).toContain('HEALTH_ALERTS_CHANNEL')
  })
})
