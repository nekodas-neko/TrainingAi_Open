#!/usr/bin/env node
// Runs every step of the CI job named "Custom Rules" locally, the way CI runs
// it, and prints how many steps it ran.
//
// Why this exists (Q-206): the gate reached for by hand is either `pnpm
// ci:local` (3 of the job's steps) or a `scripts/check-*.js` glob (20 of 31).
// Both report clean while the 11 inline grep rules — UTC date slicing,
// hardcoded session names, safe-area stacking, local-SQLite PRAGMAs, nested
// buttons, JSON.parse of LLM output, hand-rolled invalidateCache — never
// execute. #1279 shipped a direct invalidateCache() call from a component
// through a local gate that said green.
//
// The job is read with a real YAML parser, never a regex: a first attempt
// scraped `run: |` blocks textually, found 6 of 31, and announced "ALL INLINE
// CUSTOM RULES PASS" — a more confident wrong answer than running nothing. The
// ran/total count printed at the end is what makes that failure visible.
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const yaml = require('js-yaml')

const WORKFLOW = '.github/workflows/ci.yml'
const JOB_NAME = 'Custom Rules'

const repoRoot = path.resolve(__dirname, '..')

const doc = yaml.load(fs.readFileSync(path.join(repoRoot, WORKFLOW), 'utf8'))
const jobs = Object.values(doc?.jobs ?? {})
const job = jobs.find((j) => j?.name === JOB_NAME)
if (!job) {
  console.error(
    `run-custom-rules: no job named "${JOB_NAME}" in ${WORKFLOW} ` +
      `(found: ${jobs.map((j) => j?.name).join(', ')})`
  )
  process.exit(1)
}

const steps = (job.steps ?? [])
  .map((s, i) => ({ name: s?.name ?? `step ${i + 1}`, run: s?.run }))
  .filter((s) => typeof s.run === 'string')

if (steps.length === 0) {
  console.error(`run-custom-rules: job "${JOB_NAME}" has no run-steps — the workflow shape changed`)
  process.exit(1)
}

if (process.argv.includes('--list')) {
  for (const step of steps) console.log(step.name)
  process.exit(0)
}

console.log(`Custom Rules — ${steps.length} run-steps in ${WORKFLOW}\n`)

const failures = []
let ran = 0

for (const step of steps) {
  // GitHub's default shell for `run:` on ubuntu-latest is `bash -e {0}`.
  const res = spawnSync('bash', ['-e', '-c', step.run], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  ran++
  const ok = res.status === 0
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(ran).padStart(2)}/${steps.length}  ${step.name}`)
  if (!ok) {
    failures.push(step.name)
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trimEnd()
    if (out) console.log(out.replace(/^/gm, '        '))
  }
}

console.log(`\nRan ${ran} of ${steps.length} Custom Rules steps.`)

if (ran !== steps.length) {
  console.error(`run-custom-rules: expected ${steps.length} steps, ran ${ran}`)
  process.exit(1)
}
if (failures.length) {
  console.error(`\n${failures.length} failed:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('All Custom Rules steps passed.')
