/**
 * RV-179 — the JSON.parse-of-LLM-output rule scanned two files.
 *
 * It was an inline grep over `app/api` files importing `@ai-sdk`. The other AI routes reach the model
 * through `lib/ai/instrument` and `lib/ai/stream`, and nothing under `lib/` was scanned, so a bare
 * `JSON.parse` of model text in any of them passed Custom Rules. These build a small tree of fixtures
 * in a temp directory (`--root`), which is hermetic: no file in the repo is written.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const script = path.join(__dirname, '..', 'check-llm-json-parse.js')
let root: string

const put = (rel: string, src: string) => {
  const full = path.join(root, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, src)
}
const run = (): { code: number; out: string } => {
  try {
    const out = execFileSync('node', [script, '--root', root], { encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'llm-json-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('check-llm-json-parse', () => {
  it('passes on a tree with no JSON.parse in a model-calling file', () => {
    put('app/api/a/route.ts', `import { generateObject } from 'ai'\nexport const x = 1\n`)
    expect(run().code).toBe(0)
  })

  it('flags a file importing the AI SDK directly (the one case the old grep covered)', () => {
    put('app/api/coach/route.ts', `import { google } from '@ai-sdk/google'\nconst o = JSON.parse(text)\n`)
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).toContain('app/api/coach/route.ts:2')
  })

  it('flags a route that reaches the model through lib/ai — the 15 of 16 the old grep missed', () => {
    put('app/api/insight/route.ts', `import { instrumentedGenerate } from '@/lib/ai/instrument'\nconst o = JSON.parse(text)\n`)
    expect(run().out).toContain('app/api/insight/route.ts:2')
  })

  it('flags lib/ itself, which was never scanned', () => {
    put('lib/ai/helper.ts', `import { generateText } from 'ai'\nexport const f = (t: string) => JSON.parse(t)\n`)
    expect(run().out).toContain('lib/ai/helper.ts:2')
  })

  it('flags a file that only calls generateObject without importing it by a path the patterns know', () => {
    put('lib/x/wrapper.ts', `import { gen } from './local'\nconst r = await generateObject({ model })\nconst o = JSON.parse(r.text)\n`)
    expect(run().out).toContain('lib/x/wrapper.ts:3')
  })

  it('ignores JSON.parse in a file that never calls a model', () => {
    put('app/api/settings/route.ts', `import { auth } from '@/auth'\nconst o = JSON.parse(stored)\n`)
    expect(run().code).toBe(0)
  })

  it('ignores the banned call inside a comment, and in tests', () => {
    put('app/api/a/route.ts', `import { generateObject } from 'ai'\n// never JSON.parse(text) here\n/* JSON.parse(x) */\n`)
    put('app/api/a/__tests__/route.test.ts', `import { generateObject } from 'ai'\nJSON.parse(x)\n`)
    put('app/api/a/route.spec.ts', `import { generateObject } from 'ai'\nJSON.parse(x)\n`)
    expect(run().code).toBe(0)
  })

  it('allows a stated exception on the same or the previous line, and only with a reason', () => {
    put('app/api/a/route.ts', [
      `import { generateObject } from 'ai'`,
      `const a = JSON.parse(stored) // llm-json-ok: a stored column, not model output`,
      `// llm-json-ok: the request body`,
      `const b = JSON.parse(body)`,
      `const c = JSON.parse(text) // llm-json-ok:`,
    ].join('\n'))
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).toContain('app/api/a/route.ts:5')
    expect(r.out).not.toContain('route.ts:2')
    expect(r.out).not.toContain('route.ts:4')
  })

  it('reports every hit, not just the first', () => {
    put('app/api/a/route.ts', `import { generateObject } from 'ai'\nJSON.parse(a)\nJSON.parse(b)\n`)
    const r = run()
    expect(r.out).toContain('route.ts:2')
    expect(r.out).toContain('route.ts:3')
  })

  it('passes on the real repository', () => {
    const out = execFileSync('node', [script], { encoding: 'utf8', cwd: path.join(__dirname, '..', '..') })
    expect(out).toContain('check-llm-json-parse: OK')
  })
})
