#!/usr/bin/env node
// Q-114. The scale toast's progress bar and the native retry give-up deadline are the same duration
// expressed twice — once in Kotlin, once in TypeScript — because there is no shared constant across
// that boundary. The TS comment already said they "must be kept in sync by hand", and they were not:
// 12_000 against a native 16_000, so the bar finished four seconds before the native side gave up.
//
// The bar tells the owner how long to keep standing still. Under-reporting it invites stepping off
// while the service is still retrying, which loses the weigh-in it was drawn to protect.
const fs = require('fs')

const KOTLIN = 'android/app/src/main/java/com/trainingai/app/scale/ScaleBleService.kt'
const TS = 'components/capacitor-native-init.tsx'

const read = (p) => {
  if (!fs.existsSync(p)) {
    console.error(`check-scale-cycle-budget: ${p} is missing — the check cannot verify anything.`)
    process.exit(1)
  }
  return fs.readFileSync(p, 'utf8')
}

const kotlin = read(KOTLIN).match(/CYCLE_BUDGET_MS\s*=\s*([\d_]+)L/)
const ts = read(TS).match(/SCALE_CYCLE_BUDGET_MS\s*=\s*([\d_]+)/)

if (!kotlin || !ts) {
  console.error('check-scale-cycle-budget: could not find one of the constants — a rename needs this check updated, not deleted.')
  console.error(`  ${KOTLIN}: ${kotlin ? 'found' : 'NOT FOUND'}`)
  console.error(`  ${TS}: ${ts ? 'found' : 'NOT FOUND'}`)
  process.exit(1)
}

const kotlinMs = Number(kotlin[1].replace(/_/g, ''))
const tsMs = Number(ts[1].replace(/_/g, ''))

if (kotlinMs !== tsMs) {
  console.error('check-scale-cycle-budget: the scale cycle budget has drifted between Kotlin and TS.')
  console.error(`  ${KOTLIN} CYCLE_BUDGET_MS       = ${kotlinMs}`)
  console.error(`  ${TS} SCALE_CYCLE_BUDGET_MS = ${tsMs}`)
  console.error('The progress bar visualises the native give-up deadline. A bar that finishes early')
  console.error('tells the owner to step off while the service is still retrying. Change both together.')
  process.exit(1)
}

console.log(`check-scale-cycle-budget: OK — both sides read ${kotlinMs}ms.`)
