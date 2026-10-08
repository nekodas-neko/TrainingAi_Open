import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Issue 2641: the docs point at the generated withheld-columns list and never list it by hand.
const require_ = createRequire(import.meta.url)
const { run, withheldColumns } = require_('../check-withheld-columns-docs.js')

const SQL = `CREATE VIEW claude_ro._meta_withheld_columns AS
SELECT * FROM (VALUES
  ('users', 'password_hash'),
  ('oura_tokens', 'access_token')
) AS t(table_name, column_name);
`

function tree(map: string, charter: string, sql = SQL) {
  const root = mkdtempSync(join(tmpdir(), 'wcd-2641-'))
  mkdirSync(join(root, 'docs'), { recursive: true })
  mkdirSync(join(root, 'lib/data/postgres'), { recursive: true })
  writeFileSync(join(root, 'lib/data/postgres/claude-ro-views.sql'), sql)
  writeFileSync(join(root, 'docs/module-map.md'), map)
  writeFileSync(join(root, 'docs/data-quality-review-charter.md'), charter)
  return root
}

const GOOD_MAP = '| Read-only prod query access | see `claude_ro._meta_withheld_columns` |\n'
const GOOD_CHARTER = '- **Withheld columns:** see `claude_ro._meta_withheld_columns`.\n'

describe('check-withheld-columns-docs', () => {
  it('parses the committed SQL', () => {
    expect(withheldColumns(SQL)).toEqual([
      { table: 'users', column: 'password_hash' },
      { table: 'oura_tokens', column: 'access_token' },
    ])
  })

  it('passes when both docs point at the generated list', () => {
    const root = tree(GOOD_MAP, GOOD_CHARTER)
    try {
      expect(run(root).problems).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails when the module map lists a withheld column by hand', () => {
    const root = tree('| Read-only prod query access | withholds users.password_hash; see _meta_withheld_columns |\n', GOOD_CHARTER)
    try {
      expect(run(root).problems.join('\n')).toContain('password_hash')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails when the charter drops the pointer', () => {
    const root = tree(GOOD_MAP, '- **Withheld columns:** several.\n')
    try {
      expect(run(root).problems.join('\n')).toContain('must point at')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('passes on the real repo', () => {
    expect(run().problems).toEqual([])
  })
})
