#!/usr/bin/env node
// Runs an agent one job at a time, each in a FRESH Claude session, then waits for the next job.
// Implementer: one job = one batch milestone. BugFix: one job = one `agent: bugfix` issue.
// Owner, 2026-10-05: "after each PR is complete … clear/compact and wait for further instructions."
//
// Why a fresh session per batch rather than compaction: an agent cannot compact itself, and a
// compacted session still carries a summary forward. `claude -p` does one job and exits, so every
// batch starts from nothing but the repo and the issues — which hold all the state it needs.
//
// The "instruction" it waits for is a batch: an open milestone titled `Batch: …`, created by the
// Orchestrator (or the owner). No batch → it sleeps and checks again. Stop it with Ctrl+C.
//
//   node scripts/agent-runner.mjs                      Implementer: build each batch, wait when none
//   node scripts/agent-runner.mjs --lane engine        only batches in one lane (run a second runner
//                                                      with --lane surface to work both halves at once)
//   node scripts/agent-runner.mjs --role bugfix        BugFix: one small fix per session
//   node scripts/agent-runner.mjs --once               one job, then exit
//   node scripts/agent-runner.mjs --wait 15            minutes between checks when idle (default 30)
//
// Several runners may run at once: every job is claimed with the `in progress` label before work
// starts, and every runner skips claimed work.
//
// Permissions: a headless session cannot stop to ask, so it runs with edits accepted and a fixed
// list of commands allowed (ALLOWED below). Anything outside that list is refused, not prompted —
// which is the safe failure. Widen the list here, deliberately, if a batch keeps hitting a wall.
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const role = opt('--role') || 'implementer'
const lane = opt('--lane')
if (!['implementer', 'bugfix'].includes(role)) throw new Error(`--role must be implementer or bugfix, not ${role}`)
if (lane && !['engine', 'surface'].includes(lane)) throw new Error(`--lane must be engine or surface, not ${lane}`)
const once = args.includes('--once')
const waitMin = Number(args[args.indexOf('--wait') + 1]) || 30
const LOG_DIR = '.agent-runs'
mkdirSync(LOG_DIR, { recursive: true })

const ALLOWED = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep',
  'Bash(git:*)', 'Bash(pnpm:*)', 'Bash(npx:*)', 'Bash(node:*)', 'Bash(gh:*)',
  'Bash(adb:*)', 'Bash(docker:*)', 'Bash(curl:*)', 'Bash(ls:*)', 'Bash(cat:*)',
  'Bash(grep:*)', 'Bash(sed:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)',
  'mcp__github',
]

const laneArg = lane ? ` --lane ${lane}` : ''
const CLAIM = `CLAIM FIRST: before any other work, add the label "in progress" to every issue you are taking, so other sessions skip them. If you stop without opening a PR, remove that label again.`
const JOBS = {
  implementer: `You are the Implementer for TrainingAI, running headless on the owner's machine, one batch per session.
Read CLAUDE.md, then docs/agents/README.md, then follow docs/agents/prompts/implementer.md.
Find the next batch: \`node scripts/queue.js --next-batch${laneArg}\` (or, without gh, the oldest open milestone titled "Batch: …" whose issues are not labelled "in progress"${lane ? ` and carry "lane: ${lane}"` : ''}).
If there is none, reply with exactly NO_BATCH and stop.
${CLAIM}
Then build the whole batch as ONE pull request with a "Closes #N" line per issue, test it as the prompt says, turn on auto-merge, comment the outcome on every issue, and finish your reply with a line "BATCH_DONE <PR url>".
If you cannot finish, comment why on the issues, leave the PR as a draft, and finish with "BATCH_STUCK <reason>".`,
  bugfix: `You are BugFix for TrainingAI, running headless, one fix per session.
Read CLAUDE.md, then docs/agents/README.md, then follow docs/agents/prompts/bugfix.md.
Find the next fix: the first entry of \`node scripts/queue.js --agent bugfix${laneArg}\` (issues labelled "agent: bugfix", not blocked, not "in progress").
If there is none, reply with exactly NO_BATCH and stop.
${CLAIM}
Then fix it in one pull request with "Closes #N", reproduce first, test as the prompt says, turn on auto-merge, comment the outcome on the issue, and finish with a line "BATCH_DONE <PR url>".
If it turns out too big for a small fix, comment why, remove "in progress", and finish with "BATCH_STUCK too big".`,
}
// AGENT_RUNNER_PROMPT replaces the job, for checking the runner itself without doing real work.
const PROMPT = process.env.AGENT_RUNNER_PROMPT || JOBS[role]

function runOnce() {
  return new Promise((resolve) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const log = `${LOG_DIR}/${stamp}-${role}${lane ? `-${lane}` : ''}.log`
    const child = spawn('claude', ['-p', PROMPT, '--permission-mode', 'acceptEdits', '--allowedTools', ...ALLOWED], {
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d; appendFileSync(log, d) })
    child.stderr.on('data', (d) => appendFileSync(log, d))
    child.on('close', (code) => {
      const last = out.trim().split('\n').pop() || ''
      console.log(`[${new Date().toLocaleString()}] exit ${code} — ${last.slice(0, 160)}  (log: ${log})`)
      resolve(out.includes('NO_BATCH') ? 'idle' : 'worked')
    })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (;;) {
  const result = await runOnce()
  if (once) break
  if (result === 'idle') {
    console.log(`Nothing ready for ${role}${lane ? ` (${lane})` : ''}. Checking again in ${waitMin} min — Ctrl+C to stop.`)
    await sleep(waitMin * 60_000)
  }
}
