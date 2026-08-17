#!/usr/bin/env node
// Keeps the orientation documents readable. Same ratchet shape as check-component-size.js.
//
// These files are what every session reads before it can start, and they are the ones that rot,
// because appending to them is always the locally cheapest move. By 2026-08-17 projectOverview.md
// had reached 9,647 lines — 3,361 of them a Current Status section holding 157 dated notes in no
// date order, describing work going back ten weeks — while its own opening line called it a lean
// index. The backlog carried a 397-line header, 268 of which were one nested chain of
// "Previously N (updated ... Previously N (updated ...". Prose asking for restraint did not hold;
// nothing measured it.
//
// So: a shrink-only baseline. A file may sit at or below its recorded size and may never grow.
// A change that genuinely has to add lines raises the number here in the same PR, which puts the
// growth in the diff where it can be seen, rather than letting it drift up one commit at a time.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Baseline recorded 2026-08-17, immediately after the cleanup that produced these numbers.
//
// Raised 2026-08-17 (Tuning, Q-500/Q-501): backlog 5698 -> 5722, projectOverview 6372 -> 6382.
// Two new queue entries replacing one (Q-271 superseded by Q-500, plus Q-501) and one rewritten +
// one new Known-Issues row. This is queue and open-issue content, which is what these two files are
// for — the growth the ratchet exists to catch is narrative and dated notes, not entries.
//
// Raised 2026-08-17 (Review, Q-450…Q-455): backlog 5722 -> 5903, projectOverview 6382 -> 6428.
// Six new queue entries from the failure-cells sweep and the one Known-Issues row that indexes
// them. Same justification as above: entries, not narrative. The sweep's actual prose lives in
// docs/reviews/2026-08-17-failure-cells-running-the-app.md, which this ratchet does not govern —
// which is the split it is meant to enforce.
const BASELINE = {
  'projectOverview.md': 6428,
  'docs/implementation-backlog.md': 5945,
  'CLAUDE.md': 967,
};

// docs/overview/entries/ is a holding area. Its README sets the compaction chore at ~20 files;
// that is a chore trigger, not an error, so CI does not fail there — failing at 20 would block
// unrelated PRs for a tidiness task. This is the runaway guard instead: the directory reached 509
// before anyone swept it, and at that size it stops being a readable recent-window.
const ENTRIES_DIR = 'docs/overview/entries';
const ENTRIES_CHORE = 20;
const ENTRIES_LIMIT = 60;

const failures = [];

for (const [rel, limit] of Object.entries(BASELINE)) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`${rel} is in the baseline but does not exist — remove its row or restore it.`);
    continue;
  }
  const lines = fs.readFileSync(abs, 'utf8').split('\n').length;
  if (lines > limit) {
    failures.push(
      `${rel} is ${lines} lines, over its ${limit}-line baseline by ${lines - limit}.\n` +
        `      Move the new material to where it belongs — a journal entry, an archive, a reference\n` +
        `      doc — or raise the baseline in this file in the same PR if the growth is genuinely\n` +
        `      part of the index.`,
    );
  }
}

const entriesAbs = path.join(root, ENTRIES_DIR);
if (fs.existsSync(entriesAbs)) {
  const count = fs
    .readdirSync(entriesAbs)
    .filter((f) => f.endsWith('.md') && f !== 'README.md').length;
  if (count > ENTRIES_LIMIT) {
    failures.push(
      `${ENTRIES_DIR}/ holds ${count} loose entries, over the ${ENTRIES_LIMIT} runaway limit.\n` +
        `      Run the compaction sweep in ${ENTRIES_DIR}/README.md: fold them oldest-first into a\n` +
        `      batched docs/overview/history-*.md, starting a new one near ~250 KB, then git rm the\n` +
        `      folded files.`,
    );
  } else if (count >= ENTRIES_CHORE) {
    console.log(
      `check-doc-index-size: note — ${ENTRIES_DIR}/ holds ${count} entries, at or over the ` +
        `${ENTRIES_CHORE}-file compaction chore threshold. Not a failure; sweep it when convenient.`,
    );
  }
}

if (failures.length) {
  console.error('Doc index size check failed:\n');
  failures.forEach((f) => console.error('  • ' + f + '\n'));
  process.exit(1);
}

const sizes = Object.keys(BASELINE)
  .map((r) => `${r} ${fs.readFileSync(path.join(root, r), 'utf8').split('\n').length}`)
  .join(' · ');
console.log(`check-doc-index-size: OK — ${sizes}`);
