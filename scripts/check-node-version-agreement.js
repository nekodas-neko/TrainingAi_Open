#!/usr/bin/env node
'use strict';
//
// LA-60 — the sandbox ran Node 22 and every `ci.yml` job pinned Node 20, so a local `pnpm test`
// could pass on an API the job did not have. Measured live: `fs.globSync` is Node 22+, a new test
// used it, the whole local suite was green, and the Tests job threw `globSync is not a function`.
// `tsc` cannot see it (`@types/node` describes the INSTALLED runtime, not the pinned one) and lint
// has no opinion, so it surfaced one CI cycle at a time.
//
// **The entry could not choose between "pin the sandbox back to 20" and "raise CI to 22" without
// knowing what Railway runs, and nothing in the repo says.** It was measured instead, from
// production stack traces in `error_events`: three Node-internal frames
// (`_http_server:838`, `_http_server:832`, `events:531`) match the sandbox's Node 22.22.2 sources
// line-for-line, including the statement at each line matching the frame's function name. So
// production is Node 22 and **CI at 20 was the outlier** — testing against a runtime nothing ships
// on.
//
// This is the guard, not the fix: the fix is that `engines.node` and every workflow now say 22.
// What this stops is the drift coming back silently, which is the only reason it lasted.
//
// Deliberately a VERSION agreement rather than a banned-API list: a list of Node-22 APIs goes stale
// the moment Node 23 ships, and the thing that must be true is that the runtimes match.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const declared = pkg.engines && pkg.engines.node;

if (!declared) {
  console.error('package.json declares no `engines.node`.\n');
  console.error('  Without it nixpacks picks Railway\'s Node version on its own, so production can');
  console.error('  move to a new major with no commit anywhere. Declare it, and match the workflows.');
  process.exit(1);
}

// "22.x" / ">=22" / "22.22.2" all pin the same major, which is what has to agree.
const major = String(declared).match(/(\d+)/);
if (!major) {
  console.error(`package.json engines.node is "${declared}", which names no major version.`);
  process.exit(1);
}

const workflows = path.join(root, '.github', 'workflows');
const mismatches = [];
for (const name of fs.readdirSync(workflows).filter(f => /\.ya?ml$/.test(f))) {
  const lines = fs.readFileSync(path.join(workflows, name), 'utf8').split('\n');
  lines.forEach((line, i) => {
    const m = line.match(/^\s*node-version:\s*['"]?(\d+)/);
    if (m && m[1] !== major[1]) mismatches.push(`${name}:${i + 1}  node-version: ${m[1]}`);
  });
}

if (mismatches.length) {
  console.error(`Workflow Node version does not match package.json engines.node ("${declared}"):\n`);
  for (const m of mismatches) console.error(`      ${m}`);
  console.error('\n  A job on a different major tests against a runtime nothing ships on — which is');
  console.error('  how `globSync is not a function` reached CI green-locally. Change the workflow, or');
  console.error('  change `engines.node` and let production follow it.');
  process.exit(1);
}

console.log(`check-node-version-agreement: OK — engines.node "${declared}" matches every workflow node-version.`);
