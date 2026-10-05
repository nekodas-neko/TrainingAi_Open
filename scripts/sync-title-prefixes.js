#!/usr/bin/env node
'use strict';
// Every issue title starts with its type — `bug: …`, `feature: …` — so a list of issues can be read
// at a glance without opening the labels (owner, 2026-10-05). The `type:` LABEL is the authority;
// this keeps the title's prefix in step with it, including when the label is changed later.
//
//   node scripts/sync-title-prefixes.js --issue 2067   one issue (run by issue-triage.yml)
//   node scripts/sync-title-prefixes.js --all          every open issue (one-off backfill)
//
// An issue with no `type:` label, or more than one, is left alone: there is no single right prefix.
const { execFileSync } = require('child_process');

const TYPES = ['bug', 'feature', 'chore', 'tuning', 'question', 'device-check'];
const KNOWN_PREFIX = new RegExp(`^(?:${TYPES.join('|')})\\s*:\\s*`, 'i');

function retitle(title, labels) {
  const types = labels.filter((l) => l.startsWith('type: ')).map((l) => l.slice('type: '.length));
  if (types.length !== 1 || !TYPES.includes(types[0])) return null;
  const bare = title.replace(KNOWN_PREFIX, '').trim();
  const next = `${types[0]}: ${bare}`;
  return next === title ? null : next;
}

module.exports = { retitle };

if (require.main === module) {
  const repo = process.env.GH_REPO || 'nekodas-neko/TrainingAi_Open';
  const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const args = process.argv.slice(2);

  let issues = [];
  if (args.includes('--issue')) {
    issues = [gh(['api', `repos/${repo}/issues/${args[args.indexOf('--issue') + 1]}`])];
  } else if (args.includes('--all')) {
    for (let page = 1; ; page++) {
      const batch = gh(['api', `repos/${repo}/issues?state=open&per_page=100&page=${page}`]);
      issues.push(...batch.filter((i) => !i.pull_request));
      if (batch.length < 100) break;
    }
  } else {
    console.error('Usage: sync-title-prefixes.js --issue <n> | --all');
    process.exit(2);
  }

  let changed = 0;
  for (const i of issues) {
    const next = retitle(i.title, i.labels.map((l) => l.name));
    if (!next) continue;
    execFileSync('gh', ['api', '-X', 'PATCH', `repos/${repo}/issues/${i.number}`, '-f', `title=${next}`], { stdio: 'ignore' });
    console.log(`#${i.number}  ${next}`);
    changed++;
    // Under GitHub's content-write limit when backfilling hundreds.
    if (issues.length > 1) sleep(1500);
  }
  console.log(`${changed} of ${issues.length} retitled.`);
}
