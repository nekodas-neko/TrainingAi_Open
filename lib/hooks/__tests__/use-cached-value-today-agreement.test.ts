import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')

/**
 * **One canonical fetch variant per cache key** — the standing rule — applied to the thing that can
 * now drift: `useCachedValue`'s `today` option.
 *
 * Before that option existed the hook could only speak plain `cachedFetch`, so a `cachedFetchToday`
 * site simply could not adopt it. Adding the flag (Q-359) unblocked the other half of the sweep and
 * created exactly one new way to get it wrong: pass `today: true` for a key the rest of the app
 * treats as plain, or omit it for a key that is today-scoped. Neither is a type error, neither
 * throws, and the symptom is a *seed* that silently misses — the card paints blank on the first
 * frame and fills in after the network, which reads as slowness rather than as a bug.
 *
 * `sync-provider`'s warm list is the one place every warmed key already declares its variant, so it
 * is the reference. A key in both places must agree.
 */
function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

/** `{ key: 'x', url: …, ttl: …, today: true }` → Map('x' → true); an absent `today:` is false. */
function warmListVariants(): Map<string, boolean> {
  const src = read('components/sync-provider.tsx')
  const start = src.indexOf('const CACHE_TASKS')
  const list = src.slice(start, src.indexOf('\n]', start))
  const out = new Map<string, boolean>()
  for (const m of list.matchAll(/\{\s*key:\s*'([^']+)'([\s\S]*?)\}/g)) {
    out.set(m[1], /\btoday:\s*true/.test(m[2]))
  }
  return out
}

/** Every `useCachedValue('literal-key', …)` call, and whether it passed `today: true`. */
function hookCallVariants(): Array<{ file: string; key: string; today: boolean }> {
  const out: Array<{ file: string; key: string; today: boolean }> = []
  for (const dir of ['app', 'components']) {
    for (const abs of walk(path.join(root, dir))) {
      const src = fs.readFileSync(abs, 'utf8')
      if (!src.includes('useCachedValue')) continue
      const rel = path.relative(root, abs).replace(/\\/g, '/')
      // Only a plain string-literal key is checkable statically. A template-literal key
      // (`calendar-data:${y}-${m}`) is skipped by the `[^"'`$]+` class rather than half-matched.
      for (const m of src.matchAll(/useCachedValue<[\s\S]*?>\(\s*["'`]([^"'`$]+)["'`][\s\S]*?\n\s*\)/g)) {
        out.push({ file: rel, key: m[1], today: /\btoday:\s*true/.test(m[0]) })
      }
    }
  }
  return out
}

describe('useCachedValue today-flag agreement', () => {
  it('finds the hook call sites at all', () => {
    // Without this the two assertions below pass vacuously the moment the regex stops matching —
    // which is the failure mode a source-scanning test is most likely to have.
    expect(hookCallVariants().length).toBeGreaterThanOrEqual(4)
  })

  it('every warmed key fetched through the hook uses the warm list’s variant', () => {
    const warm = warmListVariants()
    expect(warm.size).toBeGreaterThan(10)

    const mismatches = hookCallVariants()
      .filter(c => warm.has(c.key) && warm.get(c.key) !== c.today)
      .map(c => `${c.file} reads '${c.key}' with today: ${c.today}, warm list says ${warm.get(c.key)}`)

    expect(mismatches).toEqual([])
  })

  it('two hook call sites for one key never disagree with each other', () => {
    const byKey = new Map<string, Set<boolean>>()
    for (const c of hookCallVariants()) {
      if (!byKey.has(c.key)) byKey.set(c.key, new Set())
      byKey.get(c.key)!.add(c.today)
    }
    const split = [...byKey.entries()].filter(([, v]) => v.size > 1).map(([k]) => k)
    expect(split).toEqual([])
  })
})
