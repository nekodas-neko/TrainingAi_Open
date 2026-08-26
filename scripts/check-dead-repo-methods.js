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
 * EMPTY, and worth keeping that way (LA-28, 2026-08-25).
 *
 * It shipped with six names the day before. All six were deleted once the one thing blocking them
 * was verified: `getWorkoutSessionOwners`/`getExerciseLogOwners` are bulk ownership lookups, and the
 * question was whether anything still depended on them for a guard. It does not — the sync-push path
 * verifies ownership through `ensureWorkoutSession`, which is user-scoped, refuses a session id
 * belonging to someone else, and 404s rather than 403 so it cannot become a membership oracle.
 *
 * An empty baseline is the point: a dead method is then a REGRESSION rather than a debt row, the
 * same property CLAUDE.md credits `check-aest-midnight-timezone.js` for. Adding a name here is a
 * deliberate act — do it only for a method genuinely reached by a dispatch this script cannot
 * follow (`pushMutations` keys by domain string), and write the reason beside it.
 */
const BASELINE = new Set([])

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

/**
 * Every source file in the WORKING TREE, tracked or not.
 *
 * `git ls-files` alone was wrong, and wrong in the one way that matters: it cannot see an untracked
 * file, so adding a repository method and its first caller in the same change reported the method as
 * dead until the caller happened to be staged. That is precisely the workflow this check exists to
 * support, and a guard that fails on correct code is a guard somebody deletes (LA-32 — hit while
 * shipping Q-291's `listAiHealthInsightsForDate`, whose caller was a new file).
 *
 * `--cached --others --exclude-standard` = tracked plus untracked, minus anything gitignored.
 */
function sourceFileList() {
  return execSync('git ls-files --cached --others --exclude-standard "*.ts" "*.tsx"', { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean)
}

function main() {
  const interfaceSrc = fs.readFileSync(INTERFACE_FILE, 'utf8')
  const texts = sourceFileList().filter(f => f !== INTERFACE_FILE).map(f => {
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

  console.log(dead.length === 0
    ? `check-dead-repo-methods: OK — ${names.length} repository methods, none dead. Baseline is EMPTY, so the next one is a regression.`
    : `check-dead-repo-methods: OK — ${names.length} repository methods, ${dead.length} dead (all baselined, shrink-only).`)
}

if (require.main === module) main()

module.exports = { findDead, BASELINE, sourceFileList }
