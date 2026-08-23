// Q-313 — a `lib/oura-models/constants` getter called at MODULE SCOPE opens the constants directory
// at import time, and `next build` imports every route to collect page data.
//
// Not hypothetical. A3 was recorded as having made the constants a runtime-only dependency and a
// green `publish-dry-run --all` was the evidence; six modules still read at module scope, so
// deleting the files produced `ENOENT … energy-expenditure-features.json` at *Failed to collect page
// data for /api/achievements* — a failed Railway deploy. A4b fixed those six to read on first use.
//
// **This lives in the suite rather than the Custom Rules job**, and deliberately: that job is
// checkout-only, with no `pnpm install`, which is what keeps it at ~20 seconds. The check needs the
// TypeScript compiler to be correct — a brace-counting draft flagged
// `const K_ = () => (cache ??= getAstdConstants())`, which is the A4b *fix* — and installing
// dependencies there to buy one check would tax every PR.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const checker = require_('../../../scripts/check-constants-module-scope.js') as {
  findModuleScopeReads(): { found: { file: string; line: number; name: string; text: string }[]; getterCount: number }
  moduleScopeHits(file: string, src: string, getters: Set<string>): { line: number; name: string }[]
}

describe('no model-constants getter is called at module scope', () => {
  it('finds none across lib, app, packages/shared and components', () => {
    const { found, getterCount } = checker.findModuleScopeReads()
    expect(getterCount).toBeGreaterThan(0)   // the accessor module still has getters to look for
    expect(found, found.map(f => `${f.file}:${f.line} ${f.name}()`).join('\n')).toEqual([])
  })
})

describe('the checker itself', () => {
  const getters = new Set(['getOtsConstants'])
  const hits = (src: string) => checker.moduleScopeHits('probe.ts', src, getters).map(h => h.name)

  it('catches a top-level read', () => {
    expect(hits(`import { getOtsConstants } from 'x'\nconst TOP = getOtsConstants()\n`)).toEqual(['getOtsConstants'])
  })

  it('accepts the memoised read-on-first-use shape', () => {
    // The one a brace counter got wrong, and the shape the six fixed modules actually use.
    expect(hits(`let c\nconst C_ = () => (c ??= getOtsConstants())\n`)).toEqual([])
  })

  it('accepts a plain arrow body, a function body and a class method', () => {
    expect(hits(`export const g = () => getOtsConstants()\n`)).toEqual([])
    expect(hits(`function f() { return getOtsConstants() }\n`)).toEqual([])
    expect(hits(`class K { m() { return getOtsConstants() } }\n`)).toEqual([])
  })

  it('catches a read inside a top-level object literal, which still runs on import', () => {
    expect(hits(`export const CONFIG = { table: getOtsConstants() }\n`)).toEqual(['getOtsConstants'])
  })

  it('ignores a getter it was not asked about', () => {
    expect(hits(`const X = someOtherThing()\n`)).toEqual([])
  })
})
