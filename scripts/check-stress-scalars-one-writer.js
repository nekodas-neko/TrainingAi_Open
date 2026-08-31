#!/usr/bin/env node
// BF-81. `daytime_stress_scaled`, `stress_high_minutes` and `recovery_high_minutes` describe the
// same day as `oura_daytime_stress_buckets`, and for a while two different computations wrote
// them: the rollup persisted the buckets from `latest.rhrLowBpm` + `nightHrvMs`, and
// `/api/body-battery` persisted the scalars from a series built off `restingHr` + a 28-day HRV
// mean. Measured in production over the eight days carrying both, the SIGN disagreed on six and
// high-stress minutes by 4–8×. Two numbers behind one metric is not a rounding difference — the
// strip and the number were describing different days.
//
// The rollup owns persistence because it is the only path that can re-derive history from the
// packed raw tier. Other paths may COMPUTE a summary for their own response; they must not store
// one. This checks the storing, not the computing.
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SCALARS = ['daytimeStressScaled', 'stressHighMinutes', 'recoveryHighMinutes']
const OWNER = 'lib/oura-ble/rollup/run.ts'
// The repository implementation of the upsert, not a producer — it maps whatever patch it is
// handed onto columns, so every writer's values pass through it exactly once.
const PLUMBING = new Set(['lib/data/postgres/adapter.ts', 'lib/data/postgres/slices/oura.ts', 'lib/data/postgres/rollup-io.ts'])
// A write is one of these calls carrying a scalar in its argument object.
const WRITE_CALL = /\b(upsertOuraDailyDerived|upsertDailyDerived)\s*\(/g

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

const offenders = []
let ownerWrites = 0

for (const dir of ['app', 'lib']) {
  for (const file of walk(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    const src = fs.readFileSync(file, 'utf8')
    let m
    WRITE_CALL.lastIndex = 0
    while ((m = WRITE_CALL.exec(src)) !== null) {
      // Take the call's argument span by walking parens from the opening one.
      let depth = 0, end = -1
      for (let i = m.index + m[0].length - 1; i < src.length; i++) {
        if (src[i] === '(') depth++
        else if (src[i] === ')') { depth--; if (depth === 0) { end = i; break } }
      }
      const args = src.slice(m.index, end === -1 ? src.length : end)
      const named = SCALARS.filter(k => new RegExp(`\\b${k}\\s*:`).test(args))
      if (named.length === 0) continue
      if (rel === OWNER) { ownerWrites++; continue }
      if (PLUMBING.has(rel)) continue
      offenders.push({ rel, named })
    }
  }
}

const problems = []
for (const o of offenders) {
  problems.push(
    `${o.rel} persists ${o.named.join(', ')} — only ${OWNER} may.\n` +
    `      Compute a summary for your own response if you need one, but do not store it: the\n` +
    `      rollup is the only path that can re-derive these from the packed raw tier, and a second\n` +
    `      writer means the strip and the number describe different days.`)
}
// The owner losing its write is the other failure, and the one that leaves three columns frozen.
if (ownerWrites === 0) {
  problems.push(
    `${OWNER} no longer persists any of ${SCALARS.join(', ')} — the columns would have NO writer.\n` +
    `      \`weekly-digest\` reads \`stressHighMinutes\`; restore the write rather than dropping it.`)
}

if (problems.length) {
  console.error('check-stress-scalars-one-writer FAILED\n')
  for (const p of problems) console.error(`  • ${p}\n`)
  process.exit(1)
}
console.log(`check-stress-scalars-one-writer: OK — ${OWNER} is the only persister (${ownerWrites} write site).`)
