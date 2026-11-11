/**
 * #3729 — the native app's tests compare against the Capacitor app, but read nothing outside
 * mobile/: the comparison is frozen in `mobile/tests/fixtures/web-reference.json` and the cat art in
 * `mobile/assets/cats/`. While the Capacitor app's files still exist, this keeps those copies honest,
 * so a change to the web copy, the old app's channel ids or the art is still caught. Once a file is
 * deleted with the web app, its entry has nothing to drift from and is skipped.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const repo = path.join(__dirname, '..', '..')
const reference = JSON.parse(
  readFileSync(path.join(repo, 'mobile/tests/fixtures/web-reference.json'), 'utf8'),
) as { files: Record<string, string[]> }

describe('mobile web-reference fixtures', () => {
  for (const [file, excerpts] of Object.entries(reference.files)) {
    it.skipIf(!existsSync(path.join(repo, file)))(`every excerpt of ${file} is still in it`, () => {
      const text = readFileSync(path.join(repo, file), 'utf8')
      for (const excerpt of excerpts) expect(text.includes(excerpt), excerpt).toBe(true)
    })
  }

  const ownCats = path.join(repo, 'mobile/assets/cats')
  it.skipIf(!existsSync(path.join(repo, 'public/cats')))('the native copy of the cat art matches public/cats', () => {
    const names = readdirSync(ownCats).filter((n) => n.endsWith('.svg'))
    expect(names.length).toBe(25)
    for (const n of names) {
      expect(readFileSync(path.join(ownCats, n), 'utf8'), n).toBe(
        readFileSync(path.join(repo, 'public/cats', n), 'utf8'),
      )
    }
  })
})
