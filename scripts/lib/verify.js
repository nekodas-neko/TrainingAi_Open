'use strict';
//
// `Verify:` — shipped work awaiting a look, as distinct from work that cannot start.
//
// `Gate:` carried two meanings that want opposite handling, and BF-90 measured the cost. Of 41
// gates, 31 were `device` — and **eleven of those were on work that had already shipped**, every
// one of them phrased "shipped/fixed; device check owed". A `Gate:` PARKS an entry, so those eleven
// sat in `next-item.js`'s PARKED section beside genuinely unstartable work, and the queue read a
// third worse than it was.
//
//   `Gate: device`   — do not build this until the device answers. PS-11 needs a worn ring; BF-53
//                      needs a scale on the floor. A real block, and parking is right.
//   `Verify: device` — this is done; look at it on the phone when convenient. Verification debt.
//                      It should be visible and countable, and it must NOT be parked, because
//                      parking finished work hides it behind the same wall as unstartable work.
//
// **`Verify:` does not discharge itself.** These entries are unseen on the canonical runtime, and
// this repo has shipped several bugs that were invisible in the web sandbox — the local store does
// not run there at all. The field makes the debt legible; it does not clear it.
//
// A field rather than a phrasing, for the reason `Lane:`, `Needs:`, `Gate:`, `Keep:` and
// `Reference:` are all fields: prose-detection loses the moment someone writes it a third way, and
// the tool goes back to mis-sorting without saying so.

/** The values this project knows how to resolve — the same two as `Gate:`, deliberately. */
const VERIFY_VALUES = new Set(['owner', 'device']);

/**
 * `{ value, note }` for one entry's lines, or null if it states none.
 *
 * `note` is whatever follows the value, so an entry can say what to look at without a second field:
 * `- **Verify:** device — log a saved meal and confirm it stays one row.`
 */
function verifyFromLines(lines) {
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s*\*{0,2}Verify:\*{0,2}\s*([a-z]+)\s*(?:[—–-]\s*)?(.*)$/i);
    if (!m) continue;
    return {
      value: m[1].toLowerCase(),
      note: m[2].replace(/\s+/g, ' ').replace(/\*\*/g, '').trim(),
    };
  }
  return null;
}

/**
 * Why an entry's `Gate:`/`Verify:` pair is malformed, or null when it is fine.
 *
 * Lives here rather than inline in the checker so it is testable without a temp repo, and so the
 * parser and the rule cannot disagree — the drift that once put the lane rule in two files and let
 * them diverge inside a day.
 *
 * The same value in both fields is a **contradiction**, not redundancy: one says the work cannot
 * start, the other says it has shipped. Left unchecked the gate wins silently — the entry parks —
 * and the `Verify:` reads as applied while changing nothing, which is worse than never writing it.
 * Different values are fine: an entry can be blocked on the owner and, later, owe a device look.
 */
function verifyProblem(gates, verify) {
  if (!verify) return null;
  if (!VERIFY_VALUES.has(verify.value)) return { kind: 'unknown-value', value: verify.value };
  if (gates.includes(verify.value)) return { kind: 'contradicts-gate', value: verify.value };
  return null;
}

module.exports = { verifyFromLines, verifyProblem, VERIFY_VALUES };
