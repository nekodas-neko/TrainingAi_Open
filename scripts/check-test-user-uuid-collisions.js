#!/usr/bin/env node
/**
 * Two test files that hardcode the SAME user UUID, where at least one DELETEs it, are a time bomb.
 *
 * Vitest runs files in parallel workers against one shared local Postgres, so file B's cleanup can
 * land between file A's seed and its first query. A dies on a foreign key, naming a table neither
 * PR touched — and it stays hidden for exactly as long as scheduling keeps the two apart, which
 * means **adding an unrelated test file is enough to set it off.** That happened three times on
 * 2026-08-25/26 (`...05e3`, `...f002`, `...cf01`/`...cf02`), each time surfaced by a new file in a
 * PR that had nothing to do with the failure.
 *
 * WHY THIS IS A SCRIPT AND NOT A GREP. The obvious rule — "flag a UUID literal in two files where
 * one mentions DELETE FROM users" — was measured first and returned **6 hits of which 5 were false
 * positives**: `...d011` is a *program* id in one file, and `fe481797` is the canonical
 * `claude_ro` owner that two files are SUPPOSED to agree on. A check that is 83% noise gets
 * baselined into uselessness by the first person it stops. So the rule here is narrower: the UUID
 * must be used as a USER id — reached by an `INSERT INTO users` / `DELETE FROM users` statement,
 * directly or through a const named in one — in two or more files, with at least one deleting it.
 *
 * KNOWN BLIND SPOT: a user id passed through a helper the scan cannot follow reads as unused. That
 * is deliberate under-reach; a false negative costs a flake, a false positive costs the check.
 *
 * BASELINE IS EMPTY and should stay so: the next collision is a regression, not a debt row.
 */
'use strict'
const fs = require('fs')
const { execSync } = require('child_process')

const BASELINE = new Set([])

const UUID = /'([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'/g
const DECL = /const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*'([0-9a-fA-F-]{36})'/g

/**
 * UUIDs a source file uses as a `users.id`, split by whether it inserts or deletes them.
 * Exported so the detection can be driven with fixtures rather than the live tree.
 */
/**
 * Every `query(...)` / `exec(...)` call in the file, as whole balanced-paren strings.
 *
 * Scanning forward from the SQL keyword does not work, and both attempts at it shipped a bug: a
 * fixed character tail swallowed the NEXT statement (reporting `db-snapshot-integration`'s
 * unrelated `ALTER ROLE … claude_ro_owner = '<uuid>'` as a deleted user), and breaking at "a line
 * ending in `)`" stopped INSIDE the SQL, which ends lines with `)` constantly
 * (`… VALUES ($1, $2, 'x', 'T')`). String-parity tracking fails too: a match beginning at the SQL
 * keyword begins mid-literal with no way to know which delimiter opened it.
 *
 * Taking the whole call has none of those failure modes — the parameter array carrying the id is
 * inside it by construction, and the next statement is outside it by construction.
 */
function queryCalls(text) {
  const out = []
  const open = /\b(?:query|exec)\s*\(/g
  let m
  while ((m = open.exec(text))) {
    let depth = 1, i = m.index + m[0].length
    while (i < text.length && depth > 0) {
      const c = text[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      i++
      if (i - m.index > 4000) break   // runaway guard; no real call is this long
    }
    out.push(text.slice(m.index, i))
  }
  return out
}

function userUuids(text) {
  const names = new Map()
  for (const [, name, uuid] of text.matchAll(DECL)) names.set(name, uuid.toLowerCase())
  const ins = new Set(), del = new Set()
  for (const seg of queryCalls(text)) {
    const isIns = /INSERT INTO users\b/.test(seg)
    const isDel = /DELETE FROM users\b/.test(seg)
    if (!isIns && !isDel) continue
    const bucket = isIns ? ins : del
    for (const [name, uuid] of names) {
      if (new RegExp(`\\b${name}\\b`).test(seg)) bucket.add(uuid)
    }
    for (const [, uuid] of seg.matchAll(UUID)) bucket.add(uuid.toLowerCase())
  }
  return { ins, del }
}

/** @param files [path, contents][] → [{uuid, holders, deleters}] */
function findCollisions(files) {
  const holders = new Map(), deleters = new Map()
  for (const [path, text] of files) {
    const { ins, del } = userUuids(text)
    for (const u of new Set([...ins, ...del])) {
      if (!holders.has(u)) holders.set(u, new Set())
      holders.get(u).add(path)
    }
    for (const u of del) {
      if (!deleters.has(u)) deleters.set(u, new Set())
      deleters.get(u).add(path)
    }
  }
  const out = []
  for (const [uuid, fs_] of holders) {
    if (fs_.size < 2) continue
    const dels = deleters.get(uuid)
    if (!dels || dels.size === 0) continue
    out.push({ uuid, holders: [...fs_].sort(), deleters: [...dels].sort() })
  }
  return out.sort((a, b) => a.uuid.localeCompare(b.uuid))
}

function main() {
  const files = execSync("git ls-files '*.test.ts'", { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean)
    .map(f => { try { return [f, fs.readFileSync(f, 'utf8')] } catch { return [f, ''] } })

  const found = findCollisions(files)
  const added = found.filter(c => !BASELINE.has(c.uuid))

  if (added.length) {
    console.error('Test files share a hardcoded user UUID that one of them DELETEs:\n')
    for (const c of added) {
      console.error(`  • ${c.uuid}`)
      for (const f of c.holders) console.error(`      ${c.deleters.includes(f) ? 'DEL' : '   '}  ${f}`)
    }
    console.error(`
One file's cleanup can land inside another's run — parallel workers, one shared database — and the
victim dies on a foreign key in a file the PR never touched. Give the incidental user its own UUID.

Two traps when you do: derive the seed email FROM the id (a stale hardcoded email left behind fails
\`users_email_unique\` under the new id), and remember a \`beforeAll\` that throws is reported by
vitest as SKIPPED tests, which reads exactly like a \`describe.skipIf\` guard firing — run it with
--reporter=verbose before believing a skip.`)
    process.exit(1)
  }

  const stale = [...BASELINE].filter(u => !found.some(c => c.uuid === u))
  if (stale.length) {
    console.error(`BASELINE lists ${stale.join(', ')}, no longer colliding — remove in this PR (shrink-only).`)
    process.exit(1)
  }

  console.log(`check-test-user-uuid-collisions: OK — ${files.length} test files, no shared user UUID with a deleter. Baseline is EMPTY, so the next one is a regression.`)
}

if (require.main === module) main()
module.exports = { userUuids, findCollisions, queryCalls, BASELINE }
