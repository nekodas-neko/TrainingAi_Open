#!/usr/bin/env node
/**
 * Every `path → symbol` claim in the orientation docs must name a symbol that exists in that file.
 *
 * `scripts/check-index-doc-paths.js` proves a path **resolves**. It cannot prove the prose beside it
 * is true, and that limit was recorded when it shipped (Q-554): a row naming a real file while
 * describing something it does not contain passes silently. This closes the mechanical half of that
 * gap — the `→ symbolName` claim, which is the part a reader acts on.
 *
 * Why it matters here specifically: `docs/module-map.md` exists so that new work does not
 * re-implement infrastructure the app already has, and CLAUDE.md's "One Formula, One Place" rule
 * points at it as the way to find the existing implementation. A row sending a reader to the right
 * file for a function that is not in it produces a second copy of the formula, which that rule calls
 * "a bug by definition".
 *
 * Deliberately a presence check, not a resolver. It asks whether the identifier appears in the file
 * at all — not whether it is exported, nor whether the signature matches. A real resolver would need
 * the TypeScript program, and the failure this guards against (a symbol that moved or was renamed)
 * shows up as absence. Verified green at 110 claims when written, so it is a ratchet on a property
 * that currently holds rather than a backlog of known breakage.
 *
 * All 110 are in `docs/module-map.md`. The domain indexes carry three more, and all three are prose
 * *about* the Q-554 finding, quoting the one path that check exempts as deliberately absent — so
 * they are skipped here by the same test, and the two checks cannot disagree.
 */
const { readFileSync, existsSync } = require('fs')
const { join } = require('path')

const ROOT = process.cwd()

const DOCS = [
  'docs/module-map.md',
  ...['sleep', 'readiness', 'heart-rate', 'cardio', 'activity', 'workouts', 'nutrition', 'body',
      'devices', 'app-shell', 'platform'].map((d) => `docs/domains/${d}/README.md`),
]

const CLAIM =
  /`((?:app|lib|components|packages|scripts)\/[A-Za-z0-9_./-]+\.tsx?)`\s*→\s*`([A-Za-z0-9_]+)/g

/** `lib/…` still names several modules that the monorepo extraction moved (Q-153). */
const resolve = (f) =>
  [f, 'packages/shared/src/' + f.replace(/^lib\//, '')]
    .map((v) => join(ROOT, v))
    .find(existsSync)

let checked = 0
const missing = []

for (const doc of DOCS) {
  readFileSync(join(ROOT, doc), 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(CLAIM)) {
      const [, file, sym] = m
      const p = resolve(file)
      if (!p) continue // check-index-doc-paths.js owns missing files; don't report twice
      checked++
      if (!new RegExp(`\\b${sym}\\b`).test(readFileSync(p, 'utf8'))) {
        missing.push({ doc, line: i + 1, file, sym })
      }
    }
  })
}

if (missing.length > 0) {
  console.error('Orientation doc(s) attribute a symbol to a file that does not contain it:\n')
  for (const m of missing) console.error(`  • ${m.doc}:${m.line}  ${m.file} → ${m.sym}`)
  console.error(
    '\nThe module map is read to find the existing implementation before writing a new one, so a row' +
      '\npointing at the wrong file is how a formula ends up with a second copy. Correct the path or' +
      '\nthe symbol — and if it moved, check whether anything else still names the old home.',
  )
  process.exit(1)
}

console.log(`check-module-map-symbols: OK — ${checked} path→symbol claims across ${DOCS.length} docs all resolve.`)
