#!/usr/bin/env node
/**
 * Gate for material that must never reach the public repo.
 *
 * `scripts/private-paths.json` lists every directory holding Oura's extracted intellectual property
 * — trained weights, baked constants, their own decompiled source, and the guides describing how to
 * obtain it. This script proves two things about that list, so the public cut rests on a check
 * rather than on a careful reading.
 *
 * 1. **The list is honest about entanglement.** Each entry declares `importedByCode`. For every
 *    entry that declares `false`, this script proves no source file imports anything inside it — a
 *    path nothing imports can be removed from the tree with no code change, which is what makes it
 *    safe to exclude from the public repo. An entry that declares `false` and is actually imported
 *    fails the build.
 *
 * 2. **The removal worklist stays visible.** Code comments that cite a private path ("Ported from
 *    docs/oura-models/readable/…") are reported, not failed. They are provenance pointers that will
 *    dangle once the target is gone, and they are themselves a roadmap to the extracted material, so
 *    the pre-cut hygiene step has to rewrite them. Counting them here means the worklist is measured
 *    rather than remembered.
 *
 * WHAT THIS DOES NOT DO. It does not check git history, and it cannot: the public repo is a fresh
 * `git init` precisely because history is unreachable by any tooling short of a rewrite. It also
 * says nothing about whether a path is still *needed* — `lib/oura-models/onnx/` is imported today
 * and must still never be published, which is why entanglement and privacy are separate fields.
 *
 * Detection is import-shaped (`from '…'`, `require('…')`, `import('…')`) with specifiers resolved to
 * repo-relative paths, not a substring grep. That is what lets it tell an import from a comment
 * mentioning the same path — the distinction the whole script turns on.
 *
 * Run: `node scripts/check-private-paths.js`
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = process.cwd()
const MANIFEST = path.join(ROOT, 'scripts', 'private-paths.json')

/** Trees whose imports are checked. Excludes `scripts/` — the tooling that uploads and sweeps these
 *  files necessarily names them, and that is not an app dependency. */
const SCAN_ROOTS = ['app', 'components', 'lib', 'packages', 'hooks', 'types']
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

function walk(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (SOURCE_EXT.has(path.extname(e.name))) out.push(full)
  }
  return out
}

/** Resolve an import specifier to a repo-relative path, or null when it is a bare package. */
function resolveSpecifier(spec, fromFile) {
  let abs
  if (spec.startsWith('@/')) abs = path.join(ROOT, spec.slice(2))
  else if (spec.startsWith('@trainingai/shared/')) {
    abs = path.join(ROOT, 'packages', 'shared', 'src', spec.slice('@trainingai/shared/'.length))
  } else if (spec.startsWith('.')) abs = path.resolve(path.dirname(fromFile), spec)
  else return null
  return path.relative(ROOT, abs).split(path.sep).join('/')
}

const IMPORT_RE = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  const entries = manifest.paths

  // ── Inventory: sizes are measured, never asserted from a doc ──────────────────────────────────
  const inventory = entries.map(entry => {
    const abs = path.join(ROOT, entry.path)
    if (!fs.existsSync(abs)) return { ...entry, present: false, files: 0, bytes: 0 }
    let files = 0
    let bytes = 0
    for (const f of allFiles(abs)) {
      if (isExcluded(f, entry)) continue
      files += 1
      bytes += fs.statSync(f).size
    }
    return { ...entry, present: true, files, bytes }
  })

  // ── Assertion: paths declared unimported really are ───────────────────────────────────────────
  const mustBeUnimported = entries.filter(e => e.importedByCode === false).map(e => e.path)
  const violations = []
  const commentMentions = []

  const sources = SCAN_ROOTS.flatMap(r => walk(path.join(ROOT, r), []))
  for (const file of sources) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/')
    const text = fs.readFileSync(file, 'utf8')

    for (const m of text.matchAll(IMPORT_RE)) {
      const resolved = resolveSpecifier(m[1], file)
      if (!resolved) continue
      const hit = mustBeUnimported.find(p => resolved.startsWith(p))
      if (hit) violations.push({ file: rel, specifier: m[1], privatePath: hit })
    }

    text.split('\n').forEach((line, i) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) return
      const hit = entries.find(e => {
        const at = line.indexOf(e.path)
        if (at === -1) return false
        // A mention of an excluded subpath is a mention of something that stays public — the golden
        // vectors under `onnx/__fixtures__/` are ours. Counting those as work to do would bury the
        // handful of comments that really do point at the extracted material.
        const mentioned = line.slice(at).split(/[\s,)'"`]/)[0]
        return !(e.excludes ?? []).some(x => mentioned.startsWith(x))
      })
      if (hit) commentMentions.push({ file: rel, line: i + 1, privatePath: hit.path })
    })
  }

  // ── Report ────────────────────────────────────────────────────────────────────────────────────
  console.log('Private-path inventory — must never reach the public repo\n')
  let totalBytes = 0
  for (const e of inventory) {
    totalBytes += e.bytes
    const size = e.present ? `${(e.bytes / 1048576).toFixed(1)} MB · ${e.files} files` : 'already removed'
    console.log(`  ${e.path.padEnd(36)} ${e.kind.padEnd(18)} ${size}`)
  }
  console.log(`\n  total tracked: ${(totalBytes / 1048576).toFixed(1)} MB`)

  if (commentMentions.length) {
    console.log(`\n${commentMentions.length} comment reference(s) to a private path.`)
    console.log('These are provenance pointers. They will dangle once the target is gone, and they')
    console.log('point a reader at the extracted material — rewrite them before the public cut:')
    for (const c of commentMentions) console.log(`  ${c.file}:${c.line} → ${c.privatePath}`)
  }

  if (violations.length) {
    console.error('\nFAIL — a path declared `importedByCode: false` is actually imported.')
    console.error('Either the manifest is wrong, or new code took a dependency on private material:')
    for (const v of violations) {
      console.error(`  ${v.file} imports '${v.specifier}' → ${v.privatePath}`)
    }
    process.exit(1)
  }

  console.log('\nOK — every path declared unimported has no importer in app source.')
}

/** Entries may be a directory or a single file — the manifest carries both. */
function allFiles(dir, out = []) {
  let entries
  try {
    if (!fs.statSync(dir).isDirectory()) return [dir]
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) allFiles(full, out)
    else out.push(full)
  }
  return out
}

function isExcluded(absFile, entry) {
  if (!entry.excludes) return false
  const rel = path.relative(ROOT, absFile).split(path.sep).join('/')
  return entry.excludes.some(x => rel.startsWith(x))
}

main()
