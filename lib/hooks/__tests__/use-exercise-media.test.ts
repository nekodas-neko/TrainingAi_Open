import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

function sourceFiles(): Array<{ rel: string; src: string }> {
  return ['app', 'components', 'lib'].flatMap(d => walk(path.join(root, d))).map(abs => ({
    rel: path.relative(root, abs).replace(/\\/g, '/'),
    src: fs.readFileSync(abs, 'utf8'),
  }))
}

/**
 * `/api/exercise-gif` was hand-rolled at four call sites before BF-65 wanted a fifth, each with its
 * own copy of the response shape. `useExerciseMedia` is the one fetch now, and the cache key it goes
 * through is what lets the ready screen paint the clip the warm-up screen fetched a minute earlier.
 *
 * Neither hook is testable as React here — both vitest projects are `environment: 'node'` with no
 * `@testing-library/react` — so these guard the parts that are source-level, which is also where
 * this defect class actually lives: a copy re-appearing, and a GIF that silently stops moving.
 */
describe('exercise media is fetched in one place', () => {
  it('no component fetches /api/exercise-gif directly', () => {
    const offenders = sourceFiles()
      .filter(({ rel }) => rel !== 'lib/hooks/use-exercise-media.ts')
      .filter(({ rel }) => !rel.startsWith('app/api/'))
      .filter(({ src }) => /fetch\(\s*[`'"][^`'"]*\/api\/exercise-gif/.test(src))
      .map(({ rel }) => rel)

    expect(offenders, 'use useExerciseMedia — a second fetch site cannot share the cache key').toEqual([])
  })

  it('every exercise-media image opts out of the optimizer', () => {
    // A GIF through `next/image` without `unoptimized` renders as a still. It appears, it looks
    // correct, and it never moves — which reads as a broken clip rather than a missing prop, so a
    // reviewer will not catch it and neither will a screenshot.
    const offenders: string[] = []
    for (const { rel, src } of sourceFiles()) {
      if (!src.includes('use-exercise-media')) continue
      for (const m of src.matchAll(/<Image\b/g)) {
        const tag = src.slice(m.index, src.indexOf('/>', m.index))
        if (!tag.includes('unoptimized')) offenders.push(`${rel} @ ${m.index}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the cache key is shared, so a second screen reads what the first fetched', () => {
    const src = fs.readFileSync(path.join(root, 'lib/hooks/use-exercise-media.ts'), 'utf8')
    expect(src).toContain("`exercise-media:${name}`")
    // The synchronous seed is the instant paint. Without it the ready screen shows a spinner for a
    // file the warm-up screen downloaded seconds earlier, which is the outcome BF-65 names.
    expect(src).toContain('readCacheSync')
  })
})
