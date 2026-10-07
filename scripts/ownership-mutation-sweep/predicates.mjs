// Finds every `user_id` scoping predicate in the Postgres data layer and builds the neutralised
// (always-true, same-shape) version of one of them. Shared by the sweep driver (`index.mjs`) and
// the vitest plugin that applies a mutation at transform time (`vitest.config.mjs`), so the two can
// never disagree about what "predicate #17 of adapter.ts" means.
//
// The three shapes are the 2026-08-09 method's two plus the drizzle-in-raw-sql form it folded in:
//
//   eq(s.foo.userId, userId)            → eq(s.foo.userId, s.foo.userId)
//   wl.user_id = ${userId}              → wl.user_id = wl.user_id
//   ${s.foo.userId} = ${userId}         → ${s.foo.userId} = ${s.foo.userId}
//
// Each rewrite is type-safe and keeps the statement's shape; it only removes the restriction to the
// caller. Deliberately NOT mutated: `eq(s.users.id, userId)` (the caller's own `users` row, a
// different class), and the `friendships` party columns (`requesterId` / `addresseeId`) — both are
// out of the method's scope and say so in the review doc rather than being silently counted.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const TARGET_FILES = [
  'lib/data/postgres/adapter.ts',
  ...fs.readdirSync(path.join(REPO_ROOT, 'lib/data/postgres/slices'))
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => `lib/data/postgres/slices/${f}`),
]

// The caller's id under every name the data layer gives it. `opts.userId` is the options-bag form.
const CALLER = String.raw`(?:opts\.)?userId`

// One combined regex, so occurrence order is a single sequence per file. Groups:
//   1: drizzle column in eq()   2: raw `x.user_id` / `user_id`   3: `${s.foo.userId}` in raw sql
const PREDICATE = new RegExp(
  String.raw`eq\(((?:[A-Za-z_$][\w$]*\.)+userId),\s*${CALLER}\)` +
  String.raw`|((?:\b[a-z_][a-z0-9_]*\.)?\buser_id)\s*=\s*\$\{${CALLER}\}` +
  String.raw`|(\$\{(?:[A-Za-z_$][\w$]*\.)+userId\})\s*=\s*\$\{${CALLER}\}`,
  'g',
)

function neutralise(match) {
  const [whole, col, raw, embedded] = match
  if (col) return `eq(${col}, ${col})`
  if (raw) return `${raw} = ${raw}`
  if (embedded) return `${embedded} = ${embedded}`
  throw new Error(`unrecognised predicate: ${whole}`)
}

const NOT_A_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'await'])
// A class member at two-space indent (adapter.ts) or a top-level function/const (slices).
const DECL = /^(?: {2})?(?:export\s+)?(?:(?:private|public|protected|static|async)\s+)*(?:function\s+|const\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*(?:=\s*(?:async\s*)?)?\(/

function enclosingMethod(lines, lineIdx) {
  for (let i = lineIdx; i >= 0; i--) {
    const m = DECL.exec(lines[i])
    if (m && !NOT_A_METHOD.has(m[1])) return m[1]
  }
  return '(top level)'
}

/** Every predicate in `source`, in occurrence order. */
export function findPredicates(source) {
  const lines = source.split('\n')
  const lineStarts = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1)
  const out = []
  for (const m of source.matchAll(PREDICATE)) {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= m.index) lo = mid
      else hi = mid - 1
    }
    out.push({
      index: out.length,
      offset: m.index,
      length: m[0].length,
      line: lo + 1,
      method: enclosingMethod(lines, lo),
      text: m[0],
      replacement: neutralise(m),
    })
  }
  return out
}

/**
 * `source` with predicate `which` neutralised — an index, or `'all'` for every predicate at once.
 * Returns null when the index does not exist, so a caller can fail loudly instead of running an
 * unmutated suite and reporting it as a survivor.
 */
export function mutate(source, which) {
  const preds = findPredicates(source)
  const chosen = which === 'all' ? preds : preds.filter((p) => p.index === which)
  if (chosen.length === 0) return null
  let out = source
  for (const p of [...chosen].reverse()) {
    out = out.slice(0, p.offset) + p.replacement + out.slice(p.offset + p.length)
  }
  return out
}
