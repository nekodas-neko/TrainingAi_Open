import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MutationSchema, SYNCED_MUTATION_DOMAINS } from '../mutation-schema'

describe('MutationSchema', () => {
  const base = { domain: 'food_logs', date: '2026-07-01', payload: { id: 'abc' } }

  it('accepts a mutation without an id (old-client shape)', () => {
    const r = MutationSchema.safeParse(base)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.id).toBeUndefined()
  })

  it('accepts and preserves an outbox id (new-client shape)', () => {
    const r = MutationSchema.safeParse({ ...base, id: '4f1c2d3e-aaaa-bbbb-cccc-1234567890ab' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.id).toBe('4f1c2d3e-aaaa-bbbb-cccc-1234567890ab')
  })

  it('rejects an unknown domain and a malformed date', () => {
    expect(MutationSchema.safeParse({ ...base, domain: 'users' }).success).toBe(false)
    expect(MutationSchema.safeParse({ ...base, date: '01/07/2026' }).success).toBe(false)
  })

  it('accepts every canonical domain (food_items regression — D-1)', () => {
    // food_items was omitted from the envelope enum while queueMutation queued it,
    // so every new-food log on the APK was silently dropped by the push route.
    expect(SYNCED_MUTATION_DOMAINS).toContain('food_items')
    for (const domain of SYNCED_MUTATION_DOMAINS) {
      expect(MutationSchema.safeParse({ ...base, domain }).success).toBe(true)
    }
  })
})

// D-2: structural guard against the next envelope-drop. Every domain string a
// `queueMutation` call site emits must be in the canonical enum, or the push
// route silently filters it and the client deletes the outbox row (D-1). This
// scans the real source so a new domain added at a call site but not to
// SYNCED_MUTATION_DOMAINS fails CI here even before it can strand data on-device.
describe('queueMutation domain coverage', () => {
  const ROOTS = ['lib', 'components', 'app']
  const domainLiteral = /domain:\s*'([a-z_]+)'/g

  function walk(dir: string, acc: string[]): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '__tests__') continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full, acc)
      else if ((full.endsWith('.ts') || full.endsWith('.tsx')) && !full.includes('.test.')) acc.push(full)
    }
    return acc
  }

  it('every domain literal in source parses against the envelope enum', () => {
    const allowed = new Set<string>(SYNCED_MUTATION_DOMAINS)
    const cwd = process.cwd()
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of walk(join(cwd, root), [])) {
        const src = readFileSync(file, 'utf8')
        for (const m of src.matchAll(domainLiteral)) {
          if (!allowed.has(m[1])) offenders.push(`${file.replace(cwd + '/', '')}: '${m[1]}'`)
        }
      }
    }
    expect(offenders, `domain literals not in SYNCED_MUTATION_DOMAINS:\n${offenders.join('\n')}`).toEqual([])
  })
})
