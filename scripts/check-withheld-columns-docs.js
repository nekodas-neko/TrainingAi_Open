#!/usr/bin/env node
/**
 * Issue 2641. The columns the `claude_ro` views withhold are decided in ONE place, `DENY` in
 * `scripts/generate-claude-ro-views.js`, and published as `claude_ro._meta_withheld_columns` in
 * `lib/data/postgres/claude-ro-views.sql`. The module map and the data-quality charter used to
 * list them by hand and had fallen behind (they missed `native_refresh_tokens`, `saved_meals` and
 * `food_items`). They now point at the generated list instead, and this check keeps it that way:
 *
 *   - the committed SQL must still carry a non-empty withheld list (else the pointer is dead), and
 *   - the two doc passages must name `_meta_withheld_columns` and must not name any withheld column.
 *
 * It reads the committed SQL, so it needs no database.
 */
const { readFileSync } = require('fs')
const { join } = require('path')

const SQL = 'lib/data/postgres/claude-ro-views.sql'

/** Doc passages that must point at the generated list: file, and text on the line that starts the passage. */
const PASSAGES = [
  { file: 'docs/module-map.md', marker: 'Read-only prod query access' },
  { file: 'docs/data-quality-review-charter.md', marker: '**Withheld columns:**' },
]

function withheldColumns(sql) {
  const start = sql.indexOf('CREATE VIEW claude_ro._meta_withheld_columns')
  if (start < 0) return []
  const end = sql.indexOf(') AS t(table_name, column_name)', start)
  if (end < 0) return []
  return [...sql.slice(start, end).matchAll(/\('([^']+)',\s*'([^']+)'\)/g)].map((m) => ({ table: m[1], column: m[2] }))
}

/** The passage: the marker line plus its indented continuation lines (a list item or table row). */
function passage(text, marker) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l.includes(marker))
  if (i < 0) return null
  const out = [lines[i]]
  for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) out.push(lines[j])
  return out.join('\n')
}

function run(root = process.cwd()) {
  const problems = []
  const cols = withheldColumns(readFileSync(join(root, SQL), 'utf8'))
  if (cols.length === 0) problems.push(`${SQL}: no rows found in claude_ro._meta_withheld_columns`)
  for (const { file, marker } of PASSAGES) {
    const p = passage(readFileSync(join(root, file), 'utf8'), marker)
    if (p === null) {
      problems.push(`${file}: no passage containing "${marker}" (update PASSAGES in this check if it moved)`)
      continue
    }
    if (!p.includes('_meta_withheld_columns')) problems.push(`${file}: "${marker}" must point at claude_ro._meta_withheld_columns`)
    for (const { table, column } of cols) {
      if (p.includes(column)) problems.push(`${file}: "${marker}" names withheld column ${table}.${column}; point at the generated list instead`)
    }
  }
  return { problems, count: cols.length }
}

module.exports = { withheldColumns, passage, run }

if (require.main === module) {
  const { problems, count } = run()
  if (problems.length) {
    console.error('check-withheld-columns-docs: FAIL\n' + problems.map((p) => '  ' + p).join('\n'))
    process.exit(1)
  }
  console.log(`check-withheld-columns-docs: OK (${count} withheld columns, none listed by hand)`)
}
