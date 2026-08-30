// LA-35 — the check that guards the orientation docs must not whitelist the error it guards against.
//
// `check-index-doc-paths.js` exists (Q-554) so a document read as "what exists and where" cannot
// name a path that does not. Its `resolves()` used to end with
// `'packages/shared/src/' + p.replace(/^lib\//, '')`, which accepted a `lib/` path whenever the file
// turned out to live under `packages/shared/src/`.
//
// That is not a lenient edge case. It is **the** error class the map exists to prevent: CLAUDE.md
// sends readers to `docs/module-map.md` precisely because the monorepo extraction moved that code
// and the docs kept saying `lib/` (Q-153). **108 paths across 8 orientation docs were wrong that
// way and every one reported OK.**
//
// A source-text check, because the failure is a line reappearing in a script rather than a
// behaviour — and because reinstating it would make the check pass *more*, which is the direction
// nobody investigates.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(process.cwd(), 'scripts/check-index-doc-paths.js'), 'utf8')

/** The resolution function only — where the string is fatal. */
const RESOLVES = SRC.slice(SRC.indexOf('const resolves ='), SRC.indexOf('let checked'))

describe('check-index-doc-paths has no lib/ -> packages/shared fallback', () => {
  it('does not rewrite a lib/ path into packages/shared/src/ before testing it', () => {
    expect(RESOLVES).not.toMatch(/replace\(\s*\/\^lib\\\//)
  })

  it('does not mention packages/shared in its resolution list at all', () => {
    expect(RESOLVES).not.toContain('packages/shared')
  })

  // WHERE the string appears is the whole distinction, and scoping to `resolves()` is not a
  // loophole in this test — it is the point. The first version asserted over the whole file and
  // went red the moment the hint was added, which would have argued for dropping the hint rather
  // than the fallback: exactly backwards.
  it('DOES still name the moved location in its failure message, as check-claude-md-paths does', () => {
    const message = SRC.slice(SRC.indexOf('if (missing.length > 0)'))
    expect(message).toContain('-> moved to')
    expect(message).toContain('packages/shared/src/')
  })

  // The reason has to survive with the deletion, or the next person reads a shorter list as an
  // oversight and helpfully restores it.
  it('records why the fallback is absent', () => {
    expect(SRC).toContain('LA-35')
  })
})
