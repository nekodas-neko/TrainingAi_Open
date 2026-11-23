// #4060 — a model call's schema may not be defined in a Next route file, and every schema a
// `generateObject` / `streamObject` call uses must be in the Gemini schema check's list.
//
// Why: a route file may export only handlers, so a schema defined there cannot be imported by
// `gemini-model-schemas-4056.test.ts`, and a construct Gemini refuses (#4056) goes unseen. This reads
// source text, so it is deliberately narrow: it looks at the `schema:` property of each call, and
// only that. Tool `inputSchema`s are covered by the Coach and chat-tool tests.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(__dirname, '../../..')
const { stripComments } = createRequire(import.meta.url)(path.join(ROOT, 'scripts/lib/strip-comments.js')) as {
  stripComments: (s: string) => string
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__', '__check_fixture__'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

type Site = { file: string; schema: string }

/** Each `generateObject(` / `streamObject(` call in app, lib and packages, with the text after `schema:`. */
function callSites(files: Array<{ file: string; text: string }>): Site[] {
  const sites: Site[] = []
  for (const { file, text } of files) {
    const src = stripComments(text)
    for (const m of src.matchAll(/\b(?:generateObject|streamObject)\s*(?:<[^>(]*>)?\s*\(/g)) {
      const before = src.slice(Math.max(0, m.index! - 12), m.index!)
      if (/function\s+$|import\s+$/.test(before)) continue
      const rest = src.slice(m.index! + m[0].length, m.index! + m[0].length + 2000)
      const s = rest.match(/\bschema\s*:\s*([^\n]*?)\s*,?\s*(?:\n|$)/)
      sites.push({ file, schema: s ? s[1].replace(/,$/, '') : '<no schema property>' })
    }
  }
  return sites
}

const sources = ['app', 'lib', 'packages/shared/src'].flatMap(d => walk(path.join(ROOT, d)))
  .map(f => ({ file: path.relative(ROOT, f), text: fs.readFileSync(f, 'utf8') }))
const guardList = fs.readFileSync(path.join(ROOT, 'lib/ai/__tests__/gemini-model-schemas-4056.test.ts'), 'utf8')

describe('model call schemas are under the Gemini schema check (#4060)', () => {
  const sites = callSites(sources)

  it('finds the structured-output call sites (so the rest cannot pass by finding nothing)', () => {
    expect(sites.length).toBeGreaterThanOrEqual(9)
    expect(new Set(sites.map(s => s.schema))).toEqual(new Set([
      'ExerciseGenSchema', 'GeneratedProgramModelSchema', 'BuilderChatObjectSchema', 'DraftSchema',
      'MealSchema', 'ScanSchema', 'TopUpSchema', 'PrescriptionSchema',
    ]))
  })

  // The scan above reads `generateObject(` / `streamObject(` by name. These are the ways to hand a
  // model a schema that it would not see, so they are refused outright until the scan learns them.
  it('no model call takes its schema by a route the scan cannot read', () => {
    const unseen = sources.flatMap(({ file, text }) => {
      const src = stripComments(text)
      return [
        /\b(?:generateObject|streamObject)\s+as\s+\w+/,
        /\bOutput\s*\.\s*object\s*\(/,
        /\bexperimental_output\b/,
      ].filter(re => re.test(src)).map(re => `${file}: ${re.source}`)
    })
    expect(unseen).toEqual([])
  })

  it('every call names its schema as an identifier, never an inline z.object(...)', () => {
    expect(sites.filter(s => !/^[A-Za-z_]\w*$/.test(s.schema)).map(s => `${s.file}: schema: ${s.schema}`)).toEqual([])
  })

  it('no schema a model call uses is defined inside the route file that makes the call', () => {
    const text = new Map(sources.map(s => [s.file, stripComments(s.text)]))
    const bad = sites
      .filter(site => /(^|\/)route\.tsx?$/.test(site.file))
      .filter(site => new RegExp(`(?:const|let|var)\\s+${site.schema}\\b`).test(text.get(site.file)!))
      .map(site => `${site.file} defines ${site.schema}`)
    expect(bad).toEqual([])
  })

  it('every schema a model call uses is in the Gemini schema check list', () => {
    const missing = [...new Set(sites.map(s => s.schema))].filter(name => !guardList.includes(`'${name} (`))
    expect(missing).toEqual([])
  })
})
