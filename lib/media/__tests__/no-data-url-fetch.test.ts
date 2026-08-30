import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildCsp } from '../../security/csp'

const root = path.resolve(__dirname, '../../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const sources = ['app', 'components', 'lib'].flatMap(d => walk(path.join(root, d))).map(abs => ({
  rel: path.relative(root, abs).replace(/\\/g, '/'),
  src: fs.readFileSync(abs, 'utf8'),
}))

/**
 * Nothing may `fetch()` a `data:` URL (BF-46 ①).
 *
 * **A `fetch()` of a `data:` URL is governed by `connect-src`, not by `img-src`**, and this app's
 * CSP does not open `connect-src` to `data:` — so the call rejects with a bare `TypeError` that
 * looks like a network failure. `MealPhotoTile` did it on the **native** branch only, to turn a
 * `CameraResultType.DataUrl` into a Blob, inside a `catch {}` written to swallow picker
 * cancellations. Result: choosing a meal photo on the phone did nothing and said nothing, through
 * three owner reports, while every browser test passed — the web branch takes a `File` from an
 * `<input>` and never fetches.
 *
 * `dataUrlToBlob` is the replacement, and `CameraResultType.Base64` avoids needing it at all.
 *
 * **This is a source scan, deliberately.** The failure has no runtime signature to assert on: it
 * only happens inside a Capacitor WebView, which no harness in this repo runs.
 */
describe('no fetch() of a data: URL', () => {
  it('the CSP still does not permit it, which is what makes the rule necessary', () => {
    const connectSrc = buildCsp(false).split(';').map(s => s.trim()).find(s => s.startsWith('connect-src'))
    expect(connectSrc, 'connect-src must exist for this rule to mean anything').toBeTruthy()
    expect(connectSrc).not.toContain('data:')
  })

  it('no source file fetches a data URL', () => {
    // A literal `data:` URL, or an identifier whose name says it holds one. Both are how this
    // arrives — the shipped bug was `fetch(photo.dataUrl)`.
    const pattern = /\bfetch\(\s*(?:`data:|'data:|"data:|[A-Za-z0-9_.]*\b(?:dataUrl|dataUri|DataUrl|DataUri)\b)/
    // Comment lines are skipped — this file and the fix's own note both describe the banned call,
    // and a rule that flags its own explanation is a rule nobody can document.
    const isCode = (line: string) => !/^\s*(\/\/|\*|\/\*)/.test(line)
    const offenders = sources.flatMap(f =>
      f.src.split('\n')
        .filter(l => isCode(l) && pattern.test(l))
        .map(l => `${f.rel}: ${l.trim()}`))
    expect(offenders, 'use dataUrlToBlob (lib/media/downscale-image.ts), or ask the plugin for Base64').toEqual([])
  })
})
