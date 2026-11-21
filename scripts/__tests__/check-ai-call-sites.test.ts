/**
 * #3752 — every model call goes through the logged wrapper, under a section from the settings table.
 *
 * The rule reads the table's keys from `lib/ai/instrument.ts` and scans the rest of the tree. These
 * build a small tree of fixtures in a temp directory (`--root`), so no file in the repo is written.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const script = path.join(__dirname, '..', 'check-ai-call-sites.js')
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

const INSTRUMENT = `
export const AI_SECTIONS = {
  prescription: OBJECT_CALL,
  'nutrition-scan': OBJECT_CALL,
  coach: { model: 'x', thinking: 'minimal', retries: 2, timeLimitMs: null },
} as const
// the wrapper itself calls the SDK bare
export function loggedStreamText(meta, params) { return streamText(params) }
`

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ai-call-sites-'))
  put('lib/ai/instrument.ts', INSTRUMENT)
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('check-ai-call-sites — the SDK is called only inside a logged wrapper', () => {
  it('passes a call wrapped under a section from the table', () => {
    put('app/api/a/route.ts', `
      import { generateObject } from 'ai'
      import { loggedGenerateObject } from '@/lib/ai/instrument'
      export const f = () => loggedGenerateObject(
        { section: 'prescription', userId: 'u', fingerprint: { a: '(' } },
        (signal, settings) => generateObject({ ...settings, abortSignal: signal, prompt: 'a ) paren in a string' }),
      )
    `)
    const r = run()
    expect(r.out).toContain('OK')
    expect(r.code).toBe(0)
  })

  it('passes a ternary of two table sections', () => {
    put('app/api/a/route.ts', `
      const f = (x: boolean) => loggedGenerateObject(
        { section: x ? 'prescription' : 'nutrition-scan' },
        (signal, settings) => generateObject({ ...settings }),
      )
    `)
    expect(run().code).toBe(0)
  })

  it('passes loggedStreamText with a table section, and a name only quoted in a comment', () => {
    put('app/api/coach/route.ts', `
      // generateObject( is how the old one did it
      const r = loggedStreamText({ section: 'coach', userId }, { system: 's' })
    `)
    expect(run().code).toBe(0)
  })

  it('fails a bare generateObject outside any wrapper', () => {
    put('app/api/b/route.ts', `import { generateObject } from 'ai'\nconst r = await generateObject({ model, prompt: 'x' })\n`)
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).toContain('app/api/b/route.ts:2')
    expect(r.out).toContain('outside a logged wrapper')
  })

  it('fails generateText and streamText outside a wrapper too', () => {
    put('lib/x/a.ts', `const a = await generateText({ prompt: 'x' })\n`)
    put('lib/x/b.ts', `const b = streamText({ prompt: 'x' })\n`)
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).toContain('lib/x/a.ts:1')
    expect(r.out).toContain('lib/x/b.ts:1')
  })

  it('fails a call that sits beside the wrapper rather than inside it', () => {
    put('app/api/c/route.ts', `
      const meta = loggedGenerateObject({ section: 'prescription' }, () => other())
      const r = await generateObject({ prompt: 'x' })
    `)
    expect(run().out).toContain('app/api/c/route.ts:3')
  })

  it('fails a section that is not in the table', () => {
    put('app/api/d/route.ts', `const r = loggedGenerateObject({ section: 'made-up' }, (s, o) => generateObject({ ...o }))\n`)
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).toContain("section 'made-up' is not in AI_SECTIONS")
  })

  it('fails a section given as a variable, which cannot be checked', () => {
    put('app/api/e/route.ts', `const r = loggedGenerateObject({ section: name }, (s, o) => generateObject({ ...o }))\n`)
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).toContain('must be a string literal')
  })

  it('fails a wrapper call that names no section', () => {
    put('app/api/f/route.ts', `const r = loggedGenerateObject(meta, (s, o) => generateObject({ ...o }))\n`)
    expect(run().out).toContain('names no `section:`')
  })

  it('ignores test files', () => {
    put('app/api/g/__tests__/x.test.ts', `await generateObject({ prompt: 'x' })\n`)
    expect(run().code).toBe(0)
  })

  it('errors when the table cannot be read, rather than passing everything', () => {
    put('lib/ai/instrument.ts', `export const nothing = 1\n`)
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).toContain('could not read AI_SECTIONS')
  })
})

describe('check-ai-call-sites — @google/genai is imported only by the image tool', () => {
  it('passes the image tool', () => {
    put('lib/exercise-image-gen.ts', `import { GoogleGenAI } from '@google/genai'\nexport const x = GoogleGenAI\n`)
    expect(run().code).toBe(0)
  })

  it('fails an import from anywhere else, in each form', () => {
    put('lib/a.ts', `import { GoogleGenAI } from '@google/genai'\n`)
    put('lib/b.ts', `const { GoogleGenAI } = require('@google/genai')\n`)
    put('lib/c.ts', `const m = await import('@google/genai')\n`)
    const r = run()
    expect(r.code).toBe(1)
    for (const f of ['lib/a.ts:1', 'lib/b.ts:1', 'lib/c.ts:1']) expect(r.out).toContain(f)
  })
})
