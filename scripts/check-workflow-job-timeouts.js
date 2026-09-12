#!/usr/bin/env node
'use strict';
//
// LA-91 — every job inherits GitHub's 360-minute default unless it says otherwise, so one hung
// step (a Playwright run that never exits, a webServer that never binds) holds a runner for six
// hours while the PR sits `mergeable_state: unstable` with nothing to distinguish it from a slow
// job. When LA-91 was filed, `emulator` was the only job in the repo with a limit.
//
// This is the guard, not the fix: the fix is the `timeout-minutes:` on each job. What this stops is
// a NEW job arriving without one, which is silent — a job with no limit looks exactly like a job
// with a generous one until something hangs.
//
// It deliberately checks only for PRESENCE, not for a particular value. The right limit is a
// property of what the job does and is sized from measured runs (see the table in LA-91's entry and
// the journal entry for the figures); a script asserting a number would either go stale as the
// suite grows or force every new job into one shape.

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '.github', 'workflows');
const missing = [];
let jobCount = 0;

for (const file of fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f))) {
  const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');

  // A job id is a 2-space-indented key directly under the top-level `jobs:`. Parsed by indentation
  // rather than with a YAML library because this repo's scripts carry no dependency of their own,
  // and the shape here is fixed: `jobs:` at column 0, each job id at column 2, its keys at 4.
  let inJobs = false;
  let current = null;
  let currentLine = 0;
  let sawTimeout = false;

  const close = () => {
    if (current && !sawTimeout) missing.push(`${file}:${currentLine}  ${current}`);
    current = null;
    sawTimeout = false;
  };

  lines.forEach((line, i) => {
    if (/^jobs:\s*$/.test(line)) { inJobs = true; return; }
    if (!inJobs) return;
    // Any non-indented, non-blank, non-comment line ends the `jobs:` block.
    if (/^\S/.test(line)) { close(); inJobs = false; return; }

    const job = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (job) { close(); current = job[1]; currentLine = i + 1; jobCount++; return; }
    if (current && /^ {4}timeout-minutes:\s*\d+\s*$/.test(line)) sawTimeout = true;
  });
  close();
}

if (missing.length) {
  console.error('Workflow jobs with no `timeout-minutes` (they inherit GitHub\'s 360-minute default):\n');
  for (const m of missing) console.error(`      ${m}`);
  console.error('\n  A hung step holds a runner for six hours and the PR stays unmergeable the whole');
  console.error('  time, looking identical to a slow job. Add `timeout-minutes:` sized from a measured');
  console.error('  run of that job — not a guess: a check-in once called 25 minutes "beyond plausible"');
  console.error('  for the E2E suite, and the real run took 24:36.');
  process.exit(1);
}

console.log(`check-workflow-job-timeouts: OK — all ${jobCount} workflow jobs declare a timeout-minutes.`);
