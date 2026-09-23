#!/usr/bin/env node
/**
 * A local write that invalidates must revalidate AFTER its push, not only before it.
 *
 * `pushMutations` is fire-and-forget, so an invalidation written beside it — above or below, it
 * makes no difference — fires while the server still holds the pre-write state. Every
 * `useCachedValue` subscriber wakes on that signal, refetches the old payload and **re-caches it**,
 * and nothing invalidates again, so the stale value stands for the key's full TTL. Home's Energy
 * Balance card read 42 kcal high for exactly this reason (LB-4).
 *
 * `pushThenRevalidate(userId, invalidator)` is the fix: the caller still invalidates immediately —
 * offline that is the only signal that will ever fire — and the helper runs the same invalidator
 * again once a push actually moved something.
 *
 * ## Why this was rewritten (LB-133, 2026-09-23)
 *
 * **The previous version reported `no write invalidates around its push` while FIVE live sites
 * carried the defect**, and it had no baseline, so the clean line read as proof. Reverting a fixed
 * site and re-running still reported clean: it was blind to the shape, not to a formatting variant.
 *
 * The cause was `WINDOW = 12` — a ±12-line text window around the call. The five sites LB-132 fixed
 * put their invalidation 14, 26, 35, 39 and 53 lines away.
 *
 * **Widening the window is the fix that already failed once.** LB-6 looked only at the six lines
 * ABOVE each call and missed five written below, so the window was widened to ±12 both ways — which
 * is how it reached the state above. A bigger number would catch today's five, miss the sixth, and
 * start matching an unrelated `invalidate*` in a neighbouring function.
 *
 * So the unit is the enclosing HANDLER, brace-matched. Three of the five put the push and the
 * invalidation in *different* blocks of one handler — inside two sibling async IIFEs, or inside a
 * nested `try` and its parent — so matching the immediately-enclosing block is not enough either.
 * The scope is the function block just inside the component/hook body: wide enough to span those
 * siblings, narrow enough that an unrelated handler in the same file is out of scope.
 *
 * `scripts/__tests__/invalidate-after-push.test.ts` pins all five shapes, taken from the real
 * pre-fix sources, so the check cannot regress to a narrower reading.
 */
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const ROOTS = ['app', 'components', 'packages', 'lib']
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__'])
// The engine itself, the helper, and the routes that run server-side.
const SKIP_FILES = [/lib[\\/]local-store[\\/]sync-engine\.ts$/, /push-then-revalidate\.ts$/, /[\\/]api[\\/]/]
const INVALIDATE = /\binvalidate[A-Z]\w*\s*\(/
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'do'])

/** Index just past the `}` closing the block opening at `openIdx` (which must be a `{`). */
function matchBrace(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return i + 1
  }
  return -1
}

/** Index of the `(` matching the `)` at `closeIdx`. */
function matchParenBack(src, closeIdx) {
  let depth = 0
  for (let i = closeIdx; i >= 0; i--) {
    if (src[i] === ')') depth++
    else if (src[i] === '(' && --depth === 0) return i
  }
  return -1
}

/**
 * Is the `{` at `idx` a function body rather than a control block?
 *
 * `=>` before it is conclusive. A `)` means we must look at the word before its matching `(`:
 * `if (…) {` and `function f(…) {` are the same two characters otherwise.
 */
function isFunctionBlock(src, idx) {
  let i = idx - 1
  while (i >= 0 && /\s/.test(src[i])) i--
  if (i < 1) return false
  if (src[i] === '>' && src[i - 1] === '=') return true
  if (src[i] !== ')') return false
  const open = matchParenBack(src, i)
  if (open < 0) return false
  let j = open - 1
  while (j >= 0 && /\s/.test(src[j])) j--
  let end = j + 1
  while (j >= 0 && /[\w$]/.test(src[j])) j--
  return !CONTROL.has(src.slice(j + 1, end))
}

/** Enclosing function-block open-brace indices at `pos`, outermost first. */
function enclosingFunctionBlocks(src, pos) {
  const open = []
  const fns = []
  for (let i = 0; i < pos; i++) {
    if (src[i] === '{') open.push(i)
    else if (src[i] === '}') open.pop()
  }
  for (const idx of open) if (isFunctionBlock(src, idx)) fns.push(idx)
  return fns
}

/**
 * Offending `pushMutations` lines: a fire-and-forget push whose handler also invalidates.
 *
 * Two shapes are not hits. A bare push with no invalidation in its handler owns no cache key — the
 * Sync buttons and the provider's own passes are flushes. And an **awaited** push already has
 * whatever follows it running after the server has the write, which is the ordering this is about.
 */
function offendersIn(src) {
  const out = []
  const CALL = /\bpushMutations\s*\(/g
  for (const m of src.matchAll(CALL)) {
    const at = m.index
    const lineStart = src.lastIndexOf('\n', at) + 1
    const line = src.slice(lineStart, src.indexOf('\n', at))
    if (/^\s*import\s/.test(line)) continue

    // Awaited, or its result read — either way what follows runs after the server has the write.
    const before = src.slice(Math.max(0, at - 80), at)
    if (/\bawait\s+$/.test(before)) continue

    // Chained to the push's own resolution — that ordering is the point, however it is written.
    const closeParen = matchBrace === null ? -1 : (() => {
      let depth = 0
      for (let i = at + m[0].length - 1; i < src.length; i++) {
        if (src[i] === '(') depth++
        else if (src[i] === ')' && --depth === 0) return i
      }
      return -1
    })()
    if (closeParen > 0 && /^\s*\.then\s*\(/.test(src.slice(closeParen + 1))) continue

    const fns = enclosingFunctionBlocks(src, at)
    if (fns.length === 0) continue
    // The handler: the function just inside the component/hook body. With only one enclosing
    // function there is no outer body to step past, so that one IS the handler.
    const scopeOpen = fns.length > 1 ? fns[1] : fns[0]
    const scopeEnd = matchBrace(src, scopeOpen)
    const scope = scopeEnd < 0 ? src.slice(scopeOpen) : src.slice(scopeOpen, scopeEnd)
    if (INVALIDATE.test(scope)) out.push(src.slice(0, at).split('\n').length)
  }
  return out
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p) && !SKIP_FILES.some(re => re.test(p))) out.push(p)
  }
  return out
}

if (require.main === module) {
  const files = ROOTS.flatMap(r => walk(path.join(root, r), []))
  const offenders = []
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    if (!src.includes('pushMutations')) continue
    const rel = path.relative(root, file).split(path.sep).join('/')
    for (const line of offendersIn(src)) offenders.push(`${rel}:${line}`)
  }

  if (offenders.length > 0) {
    console.error('These writes invalidate around a fire-and-forget push instead of after it:\n')
    for (const o of offenders) console.error(`  ${o}`)
    console.error('\nUse `pushThenRevalidate(userId, <the same invalidator>)` from')
    console.error('`@/lib/local-store/push-then-revalidate`, and keep the immediate invalidation —')
    console.error('offline it is the only one that will ever fire.')
    process.exit(1)
  }
  console.log(`Checked ${files.length} client files; no write invalidates around its push instead of after it.`)
}

module.exports = { offendersIn }
