'use strict';
//
// The backlog's entry-ID prefixes, in ONE place.
//
// Each standing agent counts up from its own letter (`docs/agents/README.md` §3): Lane A `LA-`,
// Lane B `LB-`, BugFix `BF-`, Review `RV-`, Tuning `TN-`, Orchestrator `OR-`, one-off sessions
// `PS-`, plus the legacy `Q-` numbers, which stay valid and are never renumbered.
//
// **This exists because the alternation was written out four times and `OR-` was in none of them**
// (PS-6). The Orchestrator role was created 2026-08-20 and the tooling was never taught its letter;
// it surfaced five days later, on the first `OR-` entry anyone wrote.
//
// **The failure mode was silent deletion, not a wrong label.** `next-item.js` builds an entry only
// when the heading yields an id and pushes only what it built, so an `OR-` heading was dropped from
// the queue entirely — measured: the total read **194 with and without** a scratch `OR-99` entry,
// and it appeared nowhere in the output, not even under UNCLASSIFIED. On
// `check-backlog-pointers.js` the same gap meant duplicate `OR-` ids went undetected and a
// `Needs: OR-n` never resolved to a real target — two guarantees that file advertises and, for that
// one prefix, did not give.
//
// Add a prefix here and every site gains it at once. That is the whole point: `lib/lane.js` carries
// the same lesson in its own comment, from the time its rule was duplicated and the copies drifted
// within a day.
const PREFIXES = ['LA', 'LB', 'BF', 'RV', 'TN', 'OR', 'PS', 'Q'];

const ALT = PREFIXES.join('|');

/** Matches one id anywhere in a line. Fresh object per call — a shared /g regex carries lastIndex. */
function idPattern(flags = '') {
  return new RegExp(`\\b((?:${ALT})-\\d+[a-z]?)\\b`, flags);
}

/** Same, with the prefix, number and suffix as separate groups. */
function idPartsPattern(flags = '') {
  return new RegExp(`\\b(${ALT})-(\\d+)([a-z]?)\\b`, flags);
}

module.exports = { PREFIXES, idPattern, idPartsPattern };
