#!/usr/bin/env node
// CI custom rule (CLAUDE.md "Canonical Runtime" / "Offline Sync"): the
// pushMutations method in lib/data/postgres/adapter.ts must delegate every
// domain write to the same shared repo function its web route uses — no inline
// this.db.* calls or raw sql`` templates. Inline writes are how the two paths
// drift (incidents #47, #74, #82, and the caloriesBurned data loss fixed
// 2026-07). Payload parsing/validation in the branch is fine; touching the DB
// is not.
// Limitation: brace-matching is textual (a "}" inside a string literal inside
// pushMutations would confuse it) — acceptable for this one known method body.
const fs = require('fs')

const FILE = 'lib/data/postgres/adapter.ts'
const src = fs.readFileSync(FILE, 'utf8')

const start = src.indexOf('async pushMutations(')
if (start === -1) {
  console.error(`check-push-mutations: could not find pushMutations in ${FILE}`)
  process.exit(1)
}

// Depth-match the parameter list's parens first — pushMutations takes an inline
// object-typed param (`ctx?: { origin: string; cookie: string }`), so naively
// looking for the first `{` after `start` latches onto that type literal
// instead of the function body and brace-matches closed almost immediately.
let pdepth = 0
let parenEnd = -1
for (let i = src.indexOf('(', start); i < src.length; i++) {
  if (src[i] === '(') pdepth++
  else if (src[i] === ')') {
    pdepth--
    if (pdepth === 0) { parenEnd = i; break }
  }
}
if (parenEnd === -1) {
  console.error('check-push-mutations: could not find the end of the parameter list')
  process.exit(1)
}

const bodyStart = src.indexOf('{', parenEnd)
let depth = 0
let end = -1
for (let i = bodyStart; i < src.length; i++) {
  if (src[i] === '{') depth++
  else if (src[i] === '}') {
    depth--
    if (depth === 0) { end = i; break }
  }
}
if (end === -1) {
  console.error('check-push-mutations: could not brace-match the pushMutations body')
  process.exit(1)
}

const body = src.slice(start, end)
const startLine = src.slice(0, start).split('\n').length
const violations = []
body.split('\n').forEach((line, idx) => {
  if (/this\.db\./.test(line) || /(^|[^\w`])sql`/.test(line)) {
    violations.push(`${FILE}:${startLine + idx}: ${line.trim()}`)
  }
})

if (violations.length) {
  console.error('pushMutations must not touch this.db / raw sql directly — call the shared repo function the web route uses (CLAUDE.md: Canonical Runtime / Offline Sync):')
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log('check-push-mutations: OK')
