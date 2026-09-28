#!/usr/bin/env node
'use strict';
//
// Reports which implementation plans are LIVE and which are history.
//
// A plan is live exactly while a backlog entry cites it. The protocol guarantees that: PR 1 of the
// backlog-driven flow writes the plan AND its queue entry together, and PR 2 removes the entry when
// the work ships. So "cited by docs/implementation-backlog.md" is not a heuristic — it is the
// definition, maintained by a rule that already exists.
//
// **This REPORTS, it does not gate** (the `check-doc-index-size` pattern). A plan going quiet is
// normal and expected; failing CI for it would just mean nobody writes plans.
//
// Why a script rather than a README index: an index of "current plans" is stale the moment a plan
// ships, and a stale index that gets trusted is this repo's most-repeated documentation failure —
// the backlog `Branch:` field is the standing example. A number computed at run time cannot drift.
//
// Why the 213 history plans were NOT moved to an archive directory (2026-09-27, OR-191): measured
// **729 references across 202 files**, nearly all from journal entries and handoffs that are
// records of what was true at the time. Readers reach a plan by following a link from its backlog
// entry, never by browsing the directory — so the move costs 729 rewrites and buys navigability
// nobody uses. What was actually wanted is the liveness answer, which is this.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const PLANS = path.join(root, 'docs/superpowers/plans');
const BACKLOG = path.join(root, 'docs/implementation-backlog.md');

const backlog = fs.readFileSync(BACKLOG, 'utf8');
const plans = fs.readdirSync(PLANS).filter((f) => f.endsWith('.md') && f !== 'README.md');

const live = plans.filter((p) => backlog.includes(p));
const history = plans.filter((p) => !backlog.includes(p));

console.log(
  `check-plan-liveness: ${live.length} live of ${plans.length} plans ` +
    `(${history.length} are history — cited by no queue entry).`,
);
console.log('  A plan is live exactly while a backlog entry cites it; PR 2 removes the entry when the work ships.');
if (process.argv.includes('--list')) {
  console.log('\nLIVE:');
  for (const p of live.sort()) console.log('  ' + p);
}
