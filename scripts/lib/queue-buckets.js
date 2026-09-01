'use strict';
//
// Which section of `next-item.js`'s output one entry belongs in.
//
// This is the **one judgement** in that tool, and it was three inline `else if`s that a later edit
// could reorder without anything noticing. It is a function here for the same reason `lane.js`,
// `keep.js` and `reference.js` are: so the rule can be exercised against cases the real queue does
// not currently contain. That is not hypothetical — the ordering below was mutation-tested against
// the real backlog first, and reordering `verify` ABOVE the park test **passed every test**, because
// no entry today happens to carry both a `Verify:` and a real block. The day one does, the tool
// would have offered blocked work as ready-to-look-at, silently.
//
// The order, and why each step sits where it does:
//
//   1. **parked** — a `Gate:`, an unmet `Needs:`, or an unmigrated ⛔ marker. Anything that says the
//      work cannot proceed wins over everything below, so no later field can rescue a real block.
//   2. **unclassified** — `Lane: ?` is a deliberate "I could not tell". It must reach a human rather
//      than be filed under a heading that implies someone decided.
//   3. **verify** — shipped; a look is owed. Above `keep` because it is the more specific claim about
//      the same debt: all eleven entries BF-90 measured carry both, and `Keep:` says only "residue is
//      owed" where `Verify:` names what kind and who it is waiting on.
//   4. **keep** — shipped; some other residue is owed.
//   5. **reference** — read by other entries, never built. Last because it is the only one of these
//      that says nothing is OWED, so it can never hide an obligation.
//   6. **ready** — startable work.

/**
 * @param {{lane: string|null, verify: object|null, keep: object|null, reference: string|null}} e
 * @param {string[]} reasons  why the entry is blocked; empty means nothing blocks it
 * @returns {'parked'|'unclassified'|'verify'|'keep'|'reference'|'ready'}
 */
function bucketFor(e, reasons) {
  if (reasons.length) return 'parked';
  if (e.lane === '?') return 'unclassified';
  if (e.verify) return 'verify';
  if (e.keep) return 'keep';
  if (e.reference) return 'reference';
  return 'ready';
}

module.exports = { bucketFor };
