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

describe('check-ai-call-sites — ways round the wrapper are refused', () => {
  const hit = (rel: string, src: string, needle: string | RegExp) => {
    put(rel, src)
    const r = run()
    expect(r.code).toBe(1)
    expect(r.out).toMatch(needle)
    expect(r.out).toContain(rel)
  }

  it('fails an aliased import', () => {
    hit('app/api/a/route.ts', `import { generateObject as go } from 'ai'\nawait go({})\n`, /generateObject\( called outside/)
  })
  it('fails a namespace import that calls or aliases an SDK function', () => {
    hit('app/api/a/route.ts', `import * as ai from 'ai'\nawait ai.generateObject({})\n`, /generateObject\( called outside/)
    hit('app/api/b/route.ts', `import * as ai from 'ai'\nconst f = ai.generateObject\nawait f({})\n`, /generateObject used outside/)
    hit('app/api/c/route.ts', `import * as sdk from 'ai'\nconst { generateObject: g } = sdk\n`, /sdk \(the whole module\) used outside/)
    hit('app/api/d/route.ts', `const ai = require('ai')\nai['streamText']({})\n`, /streamText\( called outside/)
    hit('app/api/e/route.ts', `const { generateText: gt } = await import('ai')\ngt({})\n`, /generateText\( called outside/)
    hit('app/api/f/route.ts', `await (await import('ai')).generateObject({})\n`, /generateObject.* outside/)
  })
  it('allows a namespace for non-calling exports such as tool and APICallError', () => {
    put('lib/a.ts', `import * as ai from 'ai'\nexport const t = ai.tool\nexport type M = ai.UIMessage\nexport const is = (e: unknown) => ai.APICallError.isInstance(e)\n`)
    expect(run().code).toBe(0)
  })
  it('fails the other SDK entry points', () => {
    hit('lib/a.ts', `await streamObject({ prompt: 'x' })\n`, /streamObject\( called outside/)
    hit('lib/b.ts', `import { embed } from 'ai'\nawait embed({ value: 'x' })\n`, /embed\( called outside/)
    hit('lib/c.ts', `import { embedMany as em } from 'ai'\nawait em({ values: [] })\n`, /embedMany\( called outside/)
    hit('lib/d.ts', `import { ToolLoopAgent } from 'ai'\nconst a = new ToolLoopAgent({ tools: {} })\n`, /ToolLoopAgent\( called outside/)
    hit('lib/e.ts', `import { generateObject } from 'ai'\nexport const f = generateObject\n`, /generateObject used outside/)
  })
  it('does not mistake an unrelated local called embed for the SDK', () => {
    put('lib/a.ts', `function embed(x: string) { return x }\nexport const y = embed('a')\n`)
    expect(run().code).toBe(0)
  })
  it('fails a re-exported SDK function and a call through the instrument module under an alias', () => {
    hit('lib/a.ts', `export { generateObject } from 'ai'\n`, /re-exported/)
    hit('lib/b.ts', `import { generateObject as go } from '@/lib/ai/instrument'\ngo({})\n`, /generateObject\( called outside/)
  })
  it('fails a subpath import of the Google SDK, in each form', () => {
    put('lib/a.ts', `import { GoogleGenAI } from '@google/genai/web'\n`)
    put('lib/b.ts', `const g = require('@google/genai/node')\n`)
    put('lib/c.ts', `const m = await import('@google/genai/web')\n`)
    put('lib/d.ts', `import '@google/genai/web'\n`)
    const r = run()
    expect(r.code).toBe(1)
    for (const f of ['lib/a.ts', 'lib/b.ts', 'lib/c.ts', 'lib/d.ts']) expect(r.out).toContain(f)
  })
  it('fails its own model, maxRetries or providerOptions inside a wrapper callback', () => {
    for (const [i, key] of (['model: google("x")', 'maxRetries: 5', 'providerOptions: {}', 'model'] as const).entries()) {
      hit(`app/api/k${i}/route.ts`, `const r = loggedGenerateObject({ section: 'prescription' }, (s, o) => generateObject({ ...o, ${key} }))\n`, /passes its own `(model|maxRetries|providerOptions)`/)
    }
    hit('app/api/m/route.ts', `const r = loggedGenerateObject({ section: 'prescription' }, (s, o) => generateObject({ ['model']: x }))\n`, /passes its own `model`/)
    hit('app/api/n/route.ts', `const r = loggedGenerateObject({ section: 'prescription' }, (s, o) => generateObject({ [k]: x }))\n`, /computed option key/)
  })
  it('fails settings handed to loggedStreamText', () => {
    hit('app/api/a/route.ts', `const r = loggedStreamText({ section: 'coach' }, { model: m, system: 's' })\n`, /loggedStreamText\(\.\.\.\) passes its own `model`/)
  })
  it('fails an SDK call whose options are not a literal object', () => {
    hit('app/api/a/route.ts', `const r = loggedGenerateObject({ section: 'prescription' }, (s, o) => generateObject(opts))\n`, /literal object/)
  })
  it('passes settings that sit deeper than the options object', () => {
    put('app/api/a/route.ts', `const r = loggedGenerateObject({ section: 'prescription' }, (s, o) => generateObject({ ...o, tools: { t: { model: 'm' } }, schema }))\n`)
    expect(run().code).toBe(0)
  })
  it('does not count an SDK call in the wrapper\'s meta argument as inside the wrapper', () => {
    hit('app/api/a/route.ts', `const r = loggedGenerateObject({ section: 'prescription', x: generateObject({ prompt: 'p' }) }, () => null)\n`, /generateObject\( called outside/)
  })
  it('reads the section from the top level of the meta argument, not a nested one', () => {
    hit('app/api/a/route.ts', `const r = loggedGenerateObject({ extra: { section: 'prescription' } }, (s, o) => generateObject({ ...o }))\n`, /names no `section:`/)
  })
  it('scans scripts/, root-level files and every JS extension', () => {
    put('scripts/a.js', `await generateObject({})\n`)
    put('scripts/b.mjs', `await generateText({})\n`)
    put('scripts/c.cjs', `await streamText({})\n`)
    put('middleware.ts', `await generateObject({})\n`)
    put('next.config.mjs', `await generateObject({})\n`)
    put('lib/d.jsx', `await generateObject({})\n`)
    const r = run()
    expect(r.code).toBe(1)
    for (const f of ['scripts/a.js', 'scripts/b.mjs', 'scripts/c.cjs', 'middleware.ts', 'next.config.mjs', 'lib/d.jsx']) expect(r.out).toContain(f)
  })
  it('still skips test files under scripts/', () => {
    put('scripts/__tests__/x.test.ts', `await generateObject({})\n`)
    expect(run().code).toBe(0)
  })
})

describe('check-ai-call-sites — mobile/src never calls the model', () => {
  it('allows the client chat plumbing', () => {
    put('mobile/src/c.ts', `import { DefaultChatTransport, type UIMessage, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'\nimport { Chat, useChat } from '@ai-sdk/react'\nimport type { UIMessageChunk } from 'ai'\n`)
    expect(run().code).toBe(0)
  })
  it('fails any other import of ai, a provider, or the Google SDK', () => {
    put('mobile/src/a.ts', `import { generateText } from 'ai'\n`)
    put('mobile/src/b.ts', `import { google } from '@ai-sdk/google'\n`)
    put('mobile/src/c.ts', `import * as ai from 'ai'\n`)
    put('mobile/src/d.ts', `import { GoogleGenAI } from '@google/genai'\n`)
    put('mobile/src/e.ts', `const m = await import('@ai-sdk/openai')\n`)
    put('mobile/src/f.ts', `import { streamText as st } from 'ai'\n`)
    const r = run()
    expect(r.code).toBe(1)
    for (const f of ['a', 'b', 'c', 'd', 'e', 'f']) expect(r.out).toContain(`mobile/src/${f}.ts`)
  })
})
