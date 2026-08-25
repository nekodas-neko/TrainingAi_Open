#!/usr/bin/env node
/**
 * A repository method that nothing calls is invisible to every other guard we have.
 *
 * TypeScript does not flag it (an unused *export* is not an error), lint does not flag it, and the
 * tests pass because they call it directly if they touch it at all. So it ships, and the only way it
 * has ever been caught here is somebody asking why a production table was empty:
 *
 *   Q-301  `saveRunningBaseline`/`getRunningBaseline` + the `running_baselines` table. The writer
 *          landed in migration 146 AFTER the only `running_plans` row existed, so it never fired.
 *          `n_tup_ins` was 0 for the table's entire life. Table dropped 2026-08-25 (Q-301b).
 *   Q-270  `training_load_ots`: a live producer writing into a table that held zero rows.
 *   Q-231  the "Exercise detected" card kept its reader after losing its only writer, so it has been
 *          permanently empty since ~2026-08-04 while looking like a working feature.
 *
 * Three instances is a class, not a coincidence — hence this check (LA-26).
 *
 * WHAT IT FLAGS, and why it is this narrow: a method declared on the `WorkoutRepository` interface
 * whose ONLY references in the whole tree are its own declaration and its own implementation. Not
 * "no caller outside `lib/data/`" — that was measured first and returns 21, most of them legitimate
 * internal helpers (`upsertOuraSleep` is called by `saveSleepSession`, `markHrSynced` by the Oura
 * slice). Those are fine, and flagging them would make this check noise. The Q-301 shape is
 * narrower and unambiguous: **nothing anywhere calls it.**
 *
 * KNOWN BLIND SPOT: `pushMutations` dispatches by domain string, so a method reached only through a
 * lookup this script cannot follow would read as dead. None of the current entries is that shape
 * (each was checked by hand), but a future one might be — which is what the baseline is for. Add it
 * with a reason rather than deleting the check.
 *
 * The baseline is SHRINK-ONLY: a name may leave it, none may join. Deleting a dead method means
 * removing its line here in the same PR.
 */
'use strict'
const fs = require('fs')
const { execSync } = require('child_process')

const INTERFACE_FILE = 'lib/data/repository.ts'
const IMPL_FILE = 'lib/data/postgres/adapter.ts'

/**
 * Dead on 2026-08-25, when this check was written. Each was verified by hand to have exactly two
 * references (the declaration and the implementation) and no dynamic-dispatch caller.
 *
 * These are NOT approved — they are recorded so the check can ship without a cleanup PR attached.
 * Removing them is follow-up work; two of them (`getWorkoutSessionOwners`, `getExerciseLogOwners`)
 * are bulk ownership lookups superseded by `ensureWorkoutSession`, and deleting a security-adjacent
 * helper deserves its own verification rather than riding along here.
 */
const BASELINE = new Set([
  'isUserActive',
  'logExercise',
  'getWorkoutSessionOwners',
  'getExerciseLogOwners',
  'getLastExerciseLog',
  'renameExerciseRefs',
])

/** Interface members sit at exactly two spaces of indent: `  name(args): Promise<T>`. */
function interfaceMethodNames(src) {
  return [...new Set([...src.matchAll(/^ {2}([a-zA-Z_][A-Za-z0-9_]*)\s*\(/gm)].map(m => m[1]))]
}

/**
 * The pure core, exported so it can be driven with fixtures rather than the live tree.
 *
 * @param interfaceSrc contents of the repository interface file
 * @param texts        [path, contents] for every other tracked source file
 * @param implFile     path whose own signature lines are definitions, not calls
 */
function findDead(interfaceSrc, texts, implFile = IMPL_FILE) {
  const names = interfaceMethodNames(interfaceSrc)
  const dead = []
  for (const name of names) {
    const call = new RegExp(`\\b${name}\\s*\\(`)
    // In the implementation file the method's own signature line is a definition, not a call.
    const definition = new RegExp(`^\\s*(?:async\\s+)?${name}\\s*\\(`)
    let called = false
    for (const [file, text] of texts) {
      if (!call.test(text)) continue
      if (file === implFile) {
        const real = text.split('\n').some(l => call.test(l) && !definition.test(l))
        if (!real) continue
      }
      called = true
      break
    }
    if (!called) dead.push(name)
  }
  return { names, dead }
}

function trackedSourceFiles() {
  return execSync('git ls-files "*.ts" "*.tsx"', { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean)
}

function main() {
  const interfaceSrc = fs.readFileSync(INTERFACE_FILE, 'utf8')
  const texts = trackedSourceFiles().filter(f => f !== INTERFACE_FILE).map(f => {
    try { return [f, fs.readFileSync(f, 'utf8')] } catch { return [f, ''] }
  })
  const { names, dead } = findDead(interfaceSrc, texts)

  const added = dead.filter(n => !BASELINE.has(n))
  const goneFromBaseline = [...BASELINE].filter(n => !dead.includes(n) && names.includes(n))
  const removedEntirely = [...BASELINE].filter(n => !names.includes(n))

  if (added.length) {
    console.error('Dead repository methods — nothing in the tree calls these:\n')
    for (const n of added) console.error(`  • ${INTERFACE_FILE}  ${n}()`)
    console.error(`
Each is declared and implemented and called by nothing. That has shipped three times here
(Q-301, Q-270, Q-231) and was never caught by a compiler, a linter or a test — only by someone
asking why a production table was empty.

Either wire it up, or delete the declaration and the implementation together. If it IS reached —
\`pushMutations\` dispatches by domain string and this script cannot follow that — add it to
BASELINE in ${__filename.split('/').pop()} with the reason.`)
    process.exit(1)
  }

  if (goneFromBaseline.length || removedEntirely.length) {
    const freed = [...goneFromBaseline, ...removedEntirely]
    console.error(`Baseline is shrink-only and ${freed.length} entr${freed.length === 1 ? 'y is' : 'ies are'} no longer dead:\n`)
    for (const n of goneFromBaseline) console.error(`  • ${n}() now has a caller`)
    for (const n of removedEntirely) console.error(`  • ${n}() is gone from the interface`)
    console.error(`\nRemove ${freed.length === 1 ? 'it' : 'them'} from BASELINE in the same PR — that is what makes the ratchet tighten.`)
    process.exit(1)
  }

  console.log(`check-dead-repo-methods: OK — ${names.length} repository methods, ${dead.length} dead (all baselined, shrink-only).`)
}

if (require.main === module) main()

module.exports = { findDead, BASELINE }
