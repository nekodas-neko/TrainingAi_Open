'use strict';
//
// A `## ` heading written INSIDE a queue entry, which silently truncates it.
//
// `next-item.js` and `check-backlog-pointers.js` both end an entry at a `## ` heading, and they must:
// the queue carries real section boundaries between batches of entries, and a field written under one
// belongs to no entry rather than to the last one above it. The cost is that a SUB-heading written at
// the wrong level does the same thing to its own entry — every field below it is invisible.
//
// **BF-165 is what this was extracted for.** It carried two `## ` sub-headings (a retraction and a
// root-cause section) and, below them, a `Verify: device` and a `Keep:`. The batch shipped and the
// entry went on printing as READY, because the tool could not see the entry past its own retraction.
//
// **The classifying rule, and it is about what FOLLOWS rather than the wording.** A genuine boundary
// is followed by prose and then a `### ` entry; a truncated entry's own FIELD bullets sit under a
// mis-levelled one. Extracted so that rule is unit-tested against the shapes that must NOT trip it —
// the same reason `decorated-field.js` exists, after an entry spent two weeks at the head of a lane.
//
// Scanning to the next `### ` rather than to the next heading is load-bearing: BF-165 has two such
// headings and its orphaned fields sit after the second, so a scan that stopped at the first
// intervening `## ` reported the entry clean.

/** The fields whose absence changes what the queue tool does with an entry. */
const FIELD = /^\s*[-*]\s*\*{0,2}(Lane|Gate|Needs|Verify|Keep|Batch|Reference|Ask):/i;

/**
 * Fields orphaned by a `## ` heading at `queue[index]`, in file order.
 *
 * @param {string[]} queue lines from the `## Queue` heading onward
 * @param {number} index   the index of the `## ` heading
 * @returns {string[]} the orphaned field bullets, trimmed; empty when this is a real boundary
 */
function orphanedFieldsBelow(queue, index) {
  const orphans = [];
  for (let j = index + 1; j < queue.length && !queue[j].startsWith('### '); j++) {
    if (FIELD.test(queue[j])) orphans.push(queue[j].trim());
  }
  return orphans;
}

module.exports = { orphanedFieldsBelow };
