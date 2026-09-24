#!/usr/bin/env node
'use strict';
//
// An owner gate must say WHAT IS OWED (OR-146).
//
// `Gate: owner` parks an entry until the owner acts. On its own it does not say what he is being
// asked FOR, and the three things it can mean need different things of him: a decision he makes
// from a brief, a production write only he may fire, or a reading somebody has to take. Until you
// know which, the entry cannot be scheduled, batched with its siblings, or put to him at all.
//
// **Measured 2026-09-24, during the triage the owner set as the Orchestrator's primary job:**
// 72 entries carried `Gate: owner`; 23 of them stated no reason on any gate line. Establishing
// what those 23 owed meant reading the body — 26 lines for `Q-4`, 170 for `LA-56`, 209 for `Q-1b`.
// That read is the cost of the job, and it is paid again by every session that looks, because
// nothing records the answer where the field is.
//
// The failure this prevents is not hypothetical and it is not slow: it is silent. `LA-89` states
// in three separate sentences that the decision is the owner's, has been gated since 2026-09-10,
// and had never been asked when the triage reached it — the gate recorded the attribution
// correctly and removed the entry from every list anyone acts on.
//
// **This is a SHAPE check, not a judgement about whether the reason is a good one.** Anything after
// `owner` on the line passes. The sibling `check-prose-parked-entries.js` records what happens when
// a detector tries to read intent: an earlier bare-glyph rule matched 28 entries of which ~7 meant
// blocked, and it parked `LA-49` — the entry describing the bug — for three weeks. A one-word
// reason passes here, and a human still decides whether it is enough.
//
// **Shrink-only against the frozen list below.** A new bare gate fails. An id that gains a reason,
// or leaves the queue, must also leave the list — so the debt can only go down.

const fs = require('fs');
const path = require('path');
const { parseEntries, bareOwnerGates, NoQueueError } = require('./lib/backlog-entries');

const ROOT = path.resolve(__dirname, '..');
const BACKLOG = path.join(ROOT, 'docs/implementation-backlog.md');

// Frozen 2026-09-24 at 23; 20 after OR-146 (Q-231, LA-56, BF-106), 17 after OR-147 (Q-4,
// TN-16, Q-297), 13 after OR-148 (LA-65, PS-43, Q-525, LA-126).
// Shrink-only: remove an id when its gate states what is owed.
const BASELINE = new Set([
  'PS-41', 'BF-77', 'LB-53',
  'Q-515', 'Q-516', 'Q-522', 'Q-523', 'Q-222', 'Q-71',
  'Q-111', 'Q-44', 'Q-31', 'Q-11',
]);

let entries;
try {
  entries = parseEntries(fs.readFileSync(BACKLOG, 'utf8').split('\n'));
} catch (err) {
  if (err instanceof NoQueueError) {
    console.error(`check-owner-gate-states-what-is-owed: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const bare = bareOwnerGates(entries);
const added = bare.filter((e) => !BASELINE.has(e.id));
const fixed = [...BASELINE].filter((id) => !bare.some((e) => e.id === id));

if (added.length) {
  console.error(
    `check-owner-gate-states-what-is-owed: ${added.length} new owner gate(s) state no reason\n`,
  );
  for (const e of added) console.error(`  ${e.id}  ${e.title.slice(0, 90)}`);
  console.error(
    '\nSay what the owner is being asked for, on the gate line itself — a decision, a production\n' +
      'write only he can fire, or a reading somebody has to take. One clause is enough:\n' +
      '  - **Gate:** owner — the drop is data-losing and needs confirmation.\n' +
      'Without it the entry cannot be scheduled, batched with its siblings, or put to him at all,\n' +
      'and the next session pays the same read to find out.',
  );
  process.exit(1);
}

if (fixed.length) {
  console.error(
    `check-owner-gate-states-what-is-owed: ${fixed.length} baselined id(s) no longer bare — ` +
      'remove them from BASELINE in this script so the ratchet holds:\n',
  );
  for (const id of fixed) console.error(`  ${id}`);
  process.exit(1);
}

console.log(
  `check-owner-gate-states-what-is-owed: OK — ${bare.length} of ${BASELINE.size} baselined ` +
    'owner gates still state no reason, none new',
);
