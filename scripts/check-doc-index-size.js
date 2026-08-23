#!/usr/bin/env node
//
// Shrink-only size ratchet for the documents every session reads before it can start.
//
// These files rot because appending to them is always the locally cheapest move: by 2026-08-17
// projectOverview.md had reached 9,647 lines while its own opening line called it a lean index.
// Prose asking for restraint did not hold; nothing measured it. So a file may sit at or below its
// recorded size and may never grow, and a change that genuinely has to add lines raises the number
// in the same PR — which puts the growth in the diff where it can be seen.
//
// The baselines live in docs/doc-size-baseline.json and the reasoning behind each change lives in
// docs/doc-size-baseline-history.md. They used to live here as comments, which is why this file had
// reached 1,091 lines with 955 of them prose: every PR that added a documentation line prepended a
// paragraph to the same region, making this the repository's most frequent merge conflict (32 of
// the last 40 commits touched it) and corrupting two blocks into verbatim duplicates. Keep the
// rationale out of this file.
//
'use strict';
const fs = require('fs');
const path = require('path');
const { resolveBaseRef, lineCountAtBase, verdict } = require('./lib/base-ref');

const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'docs/doc-size-baseline.json'), 'utf8'));
const BASELINE = config.files;
const { dir: ENTRIES_DIR, chore: ENTRIES_CHORE, limit: ENTRIES_LIMIT, totalCeiling: ENTRIES_TOTAL_CEILING } =
  config.entries;

// This log quotes historical rationale that happens to name a journal entry, so scanning it would
// mark that entry as cited by a durable doc and exempt it from compaction forever. It is a log, not
// a citation.
const NOT_A_CITATION = 'doc-size-baseline-history.md';

/** Every .md in the tree except the entries directory itself, so we can see which entries are cited. */
function linkedEntryNames(rootDir, entriesAbs) {
  let blob = '';
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
        if (path.resolve(full) === path.resolve(entriesAbs)) continue;
        walk(full);
      } else if (e.name.endsWith('.md') && e.name !== NOT_A_CITATION) {
        blob += fs.readFileSync(full, 'utf8');
      }
    }
  };
  walk(rootDir);
  return blob;
}

const failures = [];
const inherited = [];

// Q-424: the ratchet asks whether THIS BRANCH grew the file, not whether the file is over its number.
// Those are different questions the moment two PRs are open at once, and only the first one has an
// answer the branch author can act on. `null` when there is no base to compare against — a shallow
// clone with no remote — in which case the absolute baseline is all we have and is used alone.
const baseRef = resolveBaseRef();

for (const [rel, limit] of Object.entries(BASELINE)) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`${rel} is in the baseline but does not exist — remove its row or restore it.`);
    continue;
  }
  const lines = fs.readFileSync(abs, 'utf8').split('\n').length;
  if (lines <= limit) continue;

  const atBase = lineCountAtBase(baseRef, rel);
  if (verdict({ count: lines, limit, atBase }) === 'inherited') {
    // Over the number, but no bigger than what the base already holds — so the branch did not do
    // this, and failing it would be reporting someone else's merge as this author's oversized change.
    inherited.push(`${rel} is ${lines} lines against a ${limit}-line baseline, but the base branch is already ${atBase}. Not this branch's growth.`);
    continue;
  }

  const grew = atBase === null ? null : lines - atBase;
  failures.push(
    `${rel} is ${lines} lines, over its ${limit}-line baseline by ${lines - limit}` +
      (grew === null ? '.' : ` — ${grew} of which this branch added.`) + `\n` +
      `      Move the new material to where it belongs — a journal entry, an archive, a reference\n` +
      `      doc — or raise the baseline in docs/doc-size-baseline.json in the same PR, with a note\n` +
      `      in docs/doc-size-baseline-history.md, if the growth is genuinely part of the index.`,
  );
}

const entriesAbs = path.join(root, ENTRIES_DIR);
if (fs.existsSync(entriesAbs)) {
  const names = fs.readdirSync(entriesAbs).filter((f) => f.endsWith('.md') && f !== 'README.md');
  const count = names.length;
  const blob = linkedEntryNames(root, entriesAbs);
  const unlinked = names.filter((f) => !blob.includes(f));
  const linked = count - unlinked.length;

  if (unlinked.length > ENTRIES_LIMIT) {
    failures.push(
      `${ENTRIES_DIR}/ holds ${unlinked.length} foldable entries, over the ${ENTRIES_LIMIT} runaway limit\n` +
        `      (${count} total; ${linked} are linked by a durable doc and must NOT be folded).\n` +
        `      Run the compaction sweep in ${ENTRIES_DIR}/README.md: fold the UNLINKED ones oldest-first\n` +
        `      into a batched docs/overview/history-*.md, rewriting ](../../ to ](../ in each body, then\n` +
        `      git rm the folded files.`,
    );
  } else if (count > ENTRIES_TOTAL_CEILING) {
    failures.push(
      `${ENTRIES_DIR}/ holds ${count} entries, over the ${ENTRIES_TOTAL_CEILING} total ceiling — it has\n` +
        `      stopped being a readable recent-window. Only ${unlinked.length} are foldable, so a sweep\n` +
        `      alone will not fix this: the durable docs citing the other ${linked} need to point at the\n` +
        `      batched history instead.`,
    );
  } else if (unlinked.length >= ENTRIES_CHORE) {
    console.log(
      `check-doc-index-size: note — ${ENTRIES_DIR}/ holds ${unlinked.length} foldable entries ` +
        `(${count} total, ${linked} linked), at or over the ${ENTRIES_CHORE}-file compaction chore ` +
        `threshold. Not a failure; sweep it when convenient.`,
    );
  }
}

// Reported whether or not the run fails, and never as a failure: `main` being over its own baseline
// is real and worth fixing, but it is not the current branch's to fix, and answering it with a red
// check on an unrelated change is what made this class so misleading (Q-424).
if (inherited.length) {
  console.log('check-doc-index-size: inherited from the base branch, not caused here:');
  inherited.forEach((f) => console.log('  • ' + f));
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
