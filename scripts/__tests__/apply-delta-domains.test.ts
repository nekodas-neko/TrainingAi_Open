import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractDomains } = require('../lib/apply-delta-domains')

/**
 * Q-28's tripwire says a high-cardinality domain added to the sync delta makes the batching
 * refactor urgent. The check that enforces it is only as good as its SCOPE: `delta.*` is touched
 * outside `applyDeltaBody` too, so a whole-file scan would report domains whose rows never cross
 * the bridge one-per-row — and would then fail on an unrelated edit, which is how a check gets
 * deleted rather than fixed.
 */
const repoRoot = path.resolve(__dirname, '..', '..')

const method = (body: string) =>
  `class X {\n  private async applyDeltaBody(delta: D): Promise<void> {\n${body}\n  }\n}\n`

describe('extractDomains', () => {
  it('collects the domains written inside applyDeltaBody', () => {
    const r = extractDomains(method('    for (const s of delta.setLogs ?? []) {}\n    void delta.moodLogs;'))
    expect(r).toEqual({ ok: true, domains: ['moodLogs', 'setLogs'] })
  })

  it('ignores delta accesses OUTSIDE the method — the scoping the brace walk exists for', () => {
    const src = `class X {\n  async applyDelta(delta: D) {\n    void delta.ouraHeartrate;\n    await this.applyDeltaBody(delta);\n  }\n  private async applyDeltaBody(delta: D): Promise<void> {\n    void delta.setLogs;\n  }\n}\n`
    expect(extractDomains(src)).toEqual({ ok: true, domains: ['setLogs'] })
  })

  it('does not stop at a nested closing brace', () => {
    const r = extractDomains(method('    if (true) {\n      void delta.foodLogs;\n    }\n    void delta.injuries;'))
    expect(r.domains).toEqual(['foodLogs', 'injuries'])
  })

  it('de-duplicates a domain written at several call sites', () => {
    const r = extractDomains(method('    void delta.setLogs;\n    void delta.setLogs;'))
    expect(r.domains).toEqual(['setLogs'])
  })

  it('reports `missing` rather than an empty list when the method is renamed', () => {
    expect(extractDomains('class X {\n  private async applyDeltaBodyRenamed(delta: D) {\n    void delta.setLogs;\n  }\n}\n'))
      .toEqual({ ok: false, reason: 'missing' })
  })

  it('agrees with the committed baseline on the real file', () => {
    const src = readFileSync(path.join(repoRoot, 'lib/local-store/sqlite-backend.ts'), 'utf8')
    const baseline = JSON.parse(
      readFileSync(path.join(repoRoot, 'scripts/apply-delta-domains.json'), 'utf8'),
    ) as { domains: string[] }
    expect(extractDomains(src).domains).toEqual([...baseline.domains].sort())
  })
})
