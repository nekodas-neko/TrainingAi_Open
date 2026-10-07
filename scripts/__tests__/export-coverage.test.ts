// #2427. `goals` was a repository call in full-export.ts outside every list in export-map.ts, so the
// coverage check could not see it — and a repo call can read any table, an EXCLUDED one included.
// These cases keep proving the check still looks at non-table lines, not just that it passed once.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findProblems } = require('../check-export-coverage.js') as {
  findProblems: (src: { schema: string; map: string; fullExport: string }) => { problems: string[]; summary: string }
}

const root = join(__dirname, '..', '..')
const real = {
  schema: readFileSync(join(root, 'lib/data/postgres/schema.ts'), 'utf8'),
  map: readFileSync(join(root, 'lib/export/export-map.ts'), 'utf8'),
  fullExport: readFileSync(join(root, 'lib/export/full-export.ts'), 'utf8'),
}

describe('check-export-coverage — non-table lines (#2427)', () => {
  it('passes on the real tree and counts the goals line', () => {
    const { problems, summary } = findProblems(real)
    expect(problems).toEqual([])
    expect(summary).toMatch(/1 derived line/)
  })

  it('flags a repo call in full-export.ts that DERIVED_DOMAINS does not declare', () => {
    const fullExport = real.fullExport.replace(
      'yield { domain: "goals"',
      'yield { domain: "goals", extra: await repo.getOuraTokens(userId) } as never\n  yield { domain: "goals"',
    )
    expect(fullExport).not.toBe(real.fullExport)
    const { problems } = findProblems({ ...real, fullExport })
    expect(problems.join('\n')).toContain('repo.getOuraTokens() — called in full-export.ts but not declared')
  })

  it('flags a literal domain with no declaration', () => {
    const fullExport = real.fullExport.replace('yield { domain: "goals"', 'yield { domain: "secrets", row: 1 }\n  yield { domain: "goals"')
    expect(findProblems({ ...real, fullExport }).problems.join('\n')).toContain('secrets — written as a domain in full-export.ts')
  })

  it('flags a derived line built from a table the export excludes', () => {
    const map = real.map.replace("sourceTables: ['users']", "sourceTables: ['users', 'oura_tokens']")
    expect(map).not.toBe(real.map)
    expect(findProblems({ ...real, map }).problems.join('\n')).toContain('goals — built from oura_tokens, which is not in EXPORTED')
  })

  it('flags a declaration whose repo call is gone', () => {
    const fullExport = real.fullExport.replace('repo.getUserGoals(', 'repo.getUserGoalsRenamed(')
    const out = findProblems({ ...real, fullExport }).problems.join('\n')
    expect(out).toContain('goals — DERIVED_DOMAINS names repo.getUserGoals() but full-export.ts no longer calls it')
    expect(out).toContain('repo.getUserGoalsRenamed() — called in full-export.ts but not declared')
  })

  it('still flags an unclassified table (the Q-288 half is unchanged)', () => {
    const schema = real.schema + "\nexport const zz = pgTable('zz_new_table', {})\n"
    expect(findProblems({ ...real, schema }).problems.join('\n')).toContain('zz_new_table — in schema.ts but classified in neither')
  })
})
