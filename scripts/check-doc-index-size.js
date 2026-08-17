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
//
// Raised 2026-08-17 (BugFix intake, Q-387): backlog 5945 -> 5972, projectOverview 6443 -> 6461.
// One owner-reported queue entry and its Known-Issues row — entries, per the same split as the two
// raises above. Recorded because the first draft was 24/48 over and the ratchet was right to catch
// it: the trace, the measured table and the three-option assessment are what an implementer needs,
// and roughly a third of the rest was showing the work. Intake adds an entry per report, so this
// ceiling will be pushed regularly — the answer is a periodic sweep moving *cleared* entries out,
// not a standing allowance for verbose ones.
//
// Raised 2026-08-17 (BugFix intake, Q-388): backlog 5972 -> 6057, projectOverview 6461 -> 6484.
// One owner-reported queue entry, and a deliberately larger one: ~20 of its 85 lines are measured
// production tables (7-day event counts by tag, and by hour of day) behind an owner-scoped
// claude_ro view that **prunes at 30 days**. Re-deriving them after that window is impossible, so
// they are preserved in the entry rather than cited. The prose around them was cut from a first
// draft 100 over. If a later sweep moves this entry out, the tables go with it.
//
// Raised 2026-08-17 (Q-530 planning): backlog 6057 -> 6154, projectOverview 6484 -> 6488.
// One queue entry for the planned snapshot endpoint, plus a re-measurement folded into the existing
// Q-288 rather than filed as a second entry. The projectOverview half is three lines correcting a
// wrong number already in the index (/api/export covers 26 of 82 tables, not 27 of 80) and naming a
// defect that changes how it must be fixed — a correction to an existing row, not new narrative.
// The backlog half also carries Q-530's ordered step list and the new optional `Lane:` field on
// Q-530/Q-288 — routing an implementer to the right lane and flagging a shared unlisted path, which
// is queue mechanics rather than narrative and is exactly what this file governs.
//
// Raised 2026-08-17 (Lane A, Q-536 diagnosis): backlog 6417 -> 6474. The Q-536 rewrite (+19) replaces
// a refuted diagnosis with the measured one and keeps the refuted text folded in a <details>, which
// is the cheapest way to stop it being re-derived; Q-314 (+38) is the new queue entry for the root
// cause, +8 more when Q-536's repair shipped and its entry had to say which half is done. Entries
// and a corrected entry, per the same split as the raises above. projectOverview
// 6547 -> 6568 for Q-536's Known-Issues row: a live, unrepaired data-correctness fault on displayed
// health values, which is exactly what that section indexes. +3 more when the repair shipped, to
// say which half is done and which is still owed — the distinction the row exists to carry.
// Raised 2026-08-17 (one-off DB-storage planning session, Q-530…Q-535): backlog 6057 -> 6191,
// projectOverview 6484 -> 6505 — this session added 134 and 21 lines respectively, and the two
// raises landed the same day, so these numbers are the sum rather than either branch's figure.
// Both were recomputed from the merged files rather than spliced from the conflict hunks, which is
// how a merge of two same-day ratchet raises silently drops one side. Six queue entries and one
// Known-Issues row — entries, per the same
// split as the raises above. The analysis itself (the measurements, the five costed options, the
// D4 prerequisite audit) is in docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md,
// which this ratchet does not govern. Two of the six entries are blocked on an owner decision and
// carry the "what this irreversibly gives up" summary inline deliberately: an implementer must not
// have to open the plan to discover that the item is a one-way door.
//
// Raised 2026-08-17 (DB-storage planning, renumbered to Q-538…Q-542 on merge): -> 6594 / 6597.
// Five queue entries plus an amendment folding two more into a concurrent session's Q-534 rather
// than filing duplicates of it. The amendment is longer than a cross-reference because it corrects
// a measured claim in that entry (autovacuum had run; the null reading was a post-crash statistics
// artifact) and a wrong correction is more expensive than a long one.
//
// Raised again 2026-08-17 for the disk_full incident (Q-536): backlog -> 6235, projectOverview -> 6534.
// A live production outage entry and its Known-Issues row. Both carry the proven mechanism inline
// (n_tup_upd=681,005 with n_tup_hot_upd=0) rather than citing it, because the counters reset at
// crash recovery and cannot be re-derived later — the same reasoning as the Q-388 raise above.
//
// Raised 2026-08-17 (Lane A, Q-536): projectOverview 6618 -> 6642, backlog 6584 -> 6649. The Q-536
// entry rewrite replaces a refuted diagnosis with the measured one and says which half of the repair
// shipped and which is still owed; Q-314 is the new queue entry for the root cause; the
// projectOverview row is a live, unrepaired fault on displayed health values. Entries and a
// corrected entry, per the same split as the raises above.
//
// Raised 2026-08-17 (Lane A, Q-536 follow-up): projectOverview 6647 -> 6653, backlog 6649 -> 6665.
// v1.318.0's migration rolled back in production on every boot and the repair never landed; both
// entries now say so, because "shipped" was recorded here and was false. A correction to an existing
// row and an existing entry, which is the cheapest possible place to carry it.
// Raised 2026-08-17 (Lane A): backlog 6649 -> 6671. Two measured corrections onto Q-534 — its
// finding 4 is not a drop-in index drop (the index has two live consumers that would become
// sequential scans of the largest table), and the redecode's own re-stamp cost, which that entry
// gates but did not quantify. Both are corrections to an existing entry, which is cheaper to carry
// here than to have an implementer discover by dropping the index in production.
//
// Raised 2026-08-17 (Review, Q-456…Q-459): projectOverview 6655 -> 6679. One Known-Issues row
// indexing the repo-migration architecture sweep. Entries and open-issue content, not narrative —
// the sweep's prose is in docs/reviews/2026-08-17-repo-migration-architecture.md, which this
// ratchet does not govern.
//
// Raised 2026-08-17 (BugFix intake, Q-389): backlog 6682 -> 6700. One owner-requested feature entry
// (printable saved-meal labels). Only +18 because a sweep had left the file 47 under its ceiling —
// which is the intended cycle working: entries land, cleared ones leave, the number does not ratchet
// on every single filing.
//
// Raised 2026-08-17 (BugFix intake, Q-389 amendment): backlog 6700 -> 6721. The owner settled the
// two questions the entry was waiting on (50x50mm label; name + calories + code, macros optional;
// handwritten date line), so the "open questions" block became a spec. +16 net for replacing four
// lines of questions with the answers plus the QR quiet-zone/payload constraint the mockups
// surfaced. Amended in place rather than filed as a second entry, per this role's dedup rule.
//
// Raised 2026-08-17 (BugFix intake, Q-389 round-label revision): backlog 6721 -> 6735. The owner
// added that labels rotate between square and CIRCULAR dies, which changes the binding constraint
// from the square to the inscribed circle, and removed the per-serving line. Both are spec changes
// an implementer would otherwise build against wrongly, plus the measured consequence: circle-safe
// composition shrinks the code to 12.2-15.9mm and print ink-spread is the failure mode to expect.
const BASELINE = {
  // Raised again the same day for Q-310's Known-Issues row: a shipped fix that still owes a device
  // check, so it belongs here rather than in the resolved archive, which only takes an entry when
  // nothing is still owed. The evidence lives in the journal entry; only what is owed is here.
  //
  // Raised 2026-08-17 (Q-532, Lane B): 6547 -> 6562. Same shape as the line above and the same
  // justification — a shipped fix owing a device check cannot go to the resolved archive. Fifteen
  // lines for three facts a session must not have to dig for: the sandbox cannot reproduce this at
  // all, so the owner's drain run is the only verification; and no regression guard exists, because
  // neither vitest (node-only, no @testing-library/react) nor the E2E harness (needs admin + a live
  // radio) can reach the code. The mechanism, the five-site sibling sweep and the CI-rule option
  // that was considered and declined all stayed in the journal entry.
  // Raised 2026-08-17 (Q-451, Lane B): 6653 -> 6655. Recomputed from the merged file, not spliced
  // from the conflict hunk — this raise and the Lane A one above it landed the same day, which is
  // the exact case this file's earlier note says silently drops one side.
  // Striking a fixed item usually shrinks this and this one nearly did (the replacement bullet was
  // cut from 12 lines to 7). The two it is over are the two the original entry had no reason to
  // carry: that the fix is **observed but not guarded**, and the Q-352 pointer to why. A struck item
  // that can silently regress is exactly what a session must not have to discover for itself.
  'projectOverview.md': 6679,
  'docs/implementation-backlog.md': 6735,
  'CLAUDE.md': 1010,

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
