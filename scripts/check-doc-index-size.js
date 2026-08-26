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
// Each baseline is ONE FILE — docs/doc-size/<the tracked path>.size, holding a single number — and
// the reasoning for any change lives in docs/doc-size-baseline-history.md.
//
// They were a shared map in docs/doc-size-baseline.json until LA-33, and before that they were
// comments in this file, which is why it had reached 1,091 lines with 955 of them prose: every PR
// prepended a paragraph to the same region, making this the repository's most frequent merge
// conflict (32 of the last 40 commits touched it) and corrupting two blocks into verbatim
// duplicates. Moving them to a shared JSON fixed the prose problem and kept the structural one —
// every PR that raises a number edits the same two lines, so two open PRs conflict by construction.
// Measured on 2026-08-26: one PR was outrun by main four times in 35 minutes and EVERY conflict was
// in this ledger, the backlog, or the changelog — never in code.
//
// One file per tracked doc is the same fix the session journal already took (a shared history file
// → one file per entry, which its README records as taking the most frequent multi-PR conflict to
// zero). Two PRs raising two different docs now touch no common line at all; two raising the SAME
// doc still conflict, which is correct, because they genuinely disagree about one number.
//
// Keep the rationale out of this file, and out of the .size files — they hold a number and nothing
// else, so a conflict in one is a two-way choice between two integers.
//
'use strict';
const fs = require('fs');
const path = require('path');
const { resolveBaseRef, lineCountAtBase, dirNamesAtBase, verdict } = require('./lib/base-ref');
const { entriesVerdict } = require('./lib/entries-verdict');
const { BASELINE_DIR, loadBaselines, baselinePathFor } = require('./lib/doc-size-baselines');

const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'docs/doc-size-baseline.json'), 'utf8'));

const BASELINE = loadBaselines(path.join(root, BASELINE_DIR));
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
      `      doc — or raise the number in ${baselinePathFor(rel)} in the same PR, with a note\n` +
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

  // BF-36: the limit fails the branch that GREW the directory, not whichever PR is open when the
  // count crosses. `null` when the base cannot be read, which keeps the old behaviour rather than
  // letting an unreadable base silence the limit.
  const baseNames = dirNamesAtBase(baseRef, ENTRIES_DIR);
  const addedHere = baseNames === null ? null : names.filter((n) => !baseNames.includes(n)).length;

  const outcome = entriesVerdict({
    total: count,
    unlinked: unlinked.length,
    addedHere,
    chore: ENTRIES_CHORE,
    limit: ENTRIES_LIMIT,
    totalCeiling: ENTRIES_TOTAL_CEILING,
    dir: ENTRIES_DIR,
  });
  if (outcome.level === 'fail') failures.push(outcome.message);
  else if (outcome.level === 'note') console.log(`check-doc-index-size: note — ${outcome.message}`);
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
