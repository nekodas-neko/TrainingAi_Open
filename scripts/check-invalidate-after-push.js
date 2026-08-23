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
 * This exists as a check rather than a note because the class kept coming back. LB-4 fixed three
 * engine paths; LB-6 listed six more and, by looking only at the six lines ABOVE each call, missed
 * five where the invalidation is written below it. And a seventh was introduced by hand the same
 * week the helper shipped, copying the old shape from a sibling.
 *
 * Two shapes are not hits. A bare `pushMutations` with no invalidation near it owns no cache key —
 * the Sync buttons and the provider's own passes are flushes. And an **awaited** push already has
 * whatever follows it running after the server has the write, which is the ordering this is about.
 */
const { readFileSync, readdirSync } = require('node:fs')
const path = require('node:path')

const ROOTS = ['app', 'components', 'packages']
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__'])
// The engine itself, the helper, and the routes that run server-side.
const SKIP_FILES = [/lib[\\/]local-store[\\/]sync-engine\.ts$/, /push-then-revalidate\.ts$/, /[\\/]api[\\/]/]
const WINDOW = 12

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p) && !SKIP_FILES.some(re => re.test(p))) out.push(p)
  }
  return out
}

const files = ROOTS.flatMap(r => walk(r, []))
const offenders = []

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (!/\bpushMutations\s*\(/.test(line)) return
    if (/import\s/.test(line)) return
    // Chained to the push's own resolution — that ordering is the point, however it is written.
    if (/\.then\s*\(/.test(line)) return
    // Awaited: whatever follows already runs after the server has the write. Several call sites do
    // this deliberately (the Sync buttons, the provider's own passes, a push whose result is read).
    if (/\bawait\s+pushMutations/.test(line) || /=\s*await\s+pushMutations/.test(line)) return
    const near = lines.slice(Math.max(0, i - WINDOW), i + WINDOW).join('\n')
    if (/\binvalidate\w*\s*\(/.test(near)) offenders.push(`${file}:${i + 1}`)
  })
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
