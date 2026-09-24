'use strict';
//
// Parse `docs/implementation-backlog.md` into entries, in file order — which IS priority order.
//
// Extracted from `next-item.js` (TN-59) so a check can read the queue the way the tool does. The
// tool's own comments already argue for this shape: `lane.js`, `keep.js`, `reference.js` and
// `queue-buckets.js` were each pulled out so the rule could be exercised against cases the real
// queue does not currently contain, and the same file records what happens when a rule gets a
// second copy — the lane rule was briefly re-implemented inline and the two drifted within a day,
// so the unit test was testing a function the tool did not call. A second copy of the `⛔ block…`
// regex would drift the same way, and its failure mode is quieter: an entry parked in one reader
// and ready in the other.

const { laneFromLines } = require('./lane');
const { keepFromLines } = require('./keep');
const { referenceFromLines } = require('./reference');
const { verifyFromLines } = require('./verify');
const { idPattern } = require('./entry-id');

/**
 * @typedef {object} BacklogEntry
 * @property {string} id
 * @property {string} title
 * @property {string[]} tags
 * @property {string|null} lane
 * @property {string[]} laneLines
 * @property {string[]} needs
 * @property {string[]} gates
 * @property {string[]} gateLines
 * @property {string|null} batch
 * @property {string|null} legacyBlocked
 * @property {boolean} schemaRisk
 * @property {object|null} keep
 * @property {string|null} [reference]
 * @property {object|null} [verify]
 */

/** The backlog has no `## Queue` heading — it has been restructured. */
class NoQueueError extends Error {
  constructor() {
    super('no "## Queue" heading found — has the backlog been restructured?');
    this.name = 'NoQueueError';
  }
}

/**
 * @param {string[]} lines  the whole backlog file, split on newlines
 * @returns {BacklogEntry[]} entries in priority order
 * @throws {NoQueueError}
 */
function parseEntries(lines) {
  const queueStart = lines.findIndex((l) => l.trim() === '## Queue');
  if (queueStart < 0) throw new NoQueueError();

  /** Parse the queue into entries, in file order, which IS priority order. */
  const entries = [];
  let current = null;
  for (const line of lines.slice(queueStart)) {
  if (line.startsWith('### ')) {
    const id = line.match(idPattern());
    const title = line.replace(/^###\s*/, '');
    current = id
      ? { id: id[1], title, tags: [...line.matchAll(/\[([a-z-]+)\]/g)].map((m) => m[1]), lane: null, laneLines: [], needs: [], gates: [], gateLines: [], batch: null, legacyBlocked: null, schemaRisk: false, keep: null }
      : null;
    if (current) entries.push(current);
    continue;
  }
  // A `## ` section heading ends the previous entry — see check-backlog-pointers.js for why.
  if (line.startsWith('## ')) {
    current = null;
    continue;
  }
  if (!current) continue;

  const needs = line.match(/^\s*[-*]\s*\*{0,2}Needs:\*{0,2}\s*(.+)$/i);
  if (needs) for (const m of needs[1].matchAll(idPattern('g'))) current.needs.push(m[1]);

  const gate = line.match(/^\s*[-*]\s*\*{0,2}Gate:\*{0,2}\s*([a-z]+)/i);
  if (gate) {
    current.gates.push(gate[1].toLowerCase());
    current.gateLines.push(line);
  }

  const batch = line.match(/^\s*[-*]\s*\*{0,2}Batch:\*{0,2}\s*`?([^`\s]+)`?/i);
  if (batch && !current.batch) current.batch = batch[1];

  // Advisory only, and deliberately fuzzy: a batched entry that looks like it carries a schema
  // change gets flagged, because the one thing that must never be batched is a migration — its
  // blast radius is data and its revert is a corrective migration, not a git revert.
  if (/\bmigration\b|schema change|ADD COLUMN|local SQLite version/i.test(line)) current.schemaRisk = true;

  // `Lane: ?` is a deliberate "I could not tell" — it must reach a human, not be filtered away.
  //
  // The lane rule lives in `lib/lane.js` and is applied over the whole entry once it is collected —
  // NOT re-implemented here. It was, briefly, and the two copies drifted within a day: the lib
  // learned to refuse an ambiguous entry and this file went on guessing, so the unit test was
  // testing a function the tool did not call.
  current.laneLines.push(line);

  // Entries not yet migrated off the prose marker. Treated as parked, and named as unmigrated so
  // the remaining ones stay visible instead of quietly reading as ready.
  //
  // **The glyph alone is not the marker — `⛔ block…` is** (LA-49, narrowed 2026-09-22 by OR-122).
  // The file's own protocol documents the marker as `⛔ blocked: <reason>`, so this is the file's
  // convention rather than a new heuristic. Matching the bare glyph parked **28 entries of which
  // ~7 meant blocked**; the other 21 use ⛔ as an emphasis glyph for a warning to whoever BUILDS the
  // entry — *"⛔ Do not extend this to the conic-gradient rings"*, *"⛔ Do not re-litigate the
  // missing e2e"* — which is the opposite of a reason not to build it. Measured 2026-09-01 at 34/7
  // and unchanged three weeks later, because **LA-49, the entry that describes this, quotes the
  // glyph and was parked by its own bug.** A detector whose false-positive rate is 75% teaches
  // implementers to ignore the section it fills.
  //
  // ⚠ **This change is second on purpose.** LA-49's own caution is that narrowing the rule without
  // triaging first trades a section nobody reads for a section an implementer starts from — two of
  // the entries it exposes open with *"REFUTED"*. The triage shipped in the same PR: the genuinely
  // blocked ones (TN-2, Q-49, Q-72, Q-85, Q-538, Q-252) carry a `Gate:`/`Needs:` now, and the
  // refuted ones (BF-14, LA-57) carry a `Reference:`. Do not re-widen this without redoing that.
  if (!current.legacyBlocked && /⛔[^\n]{0,40}block/i.test(line)) {
    current.legacyBlocked = line.replace(/^\s*[-*]?\s*/, '').slice(0, 90);
  }
  }

  for (const e of entries) {
  e.lane = laneFromLines(e.laneLines);
  e.keep = keepFromLines(e.laneLines);
  e.reference = referenceFromLines(e.laneLines);
  e.verify = verifyFromLines(e.laneLines);
  }

  return entries;
}

/** An entry's park reasons, in the order `next-item.js` reports them. */
function parkReasons(e, inQueue) {
  const reasons = [];
  for (const n of e.needs) if (inQueue.has(n)) reasons.push(`Needs: ${n}`);
  for (const g of e.gates) reasons.push(`Gate: ${g}`);
  if (e.legacyBlocked) reasons.push(`unmigrated marker — ${e.legacyBlocked}`);
  return reasons;
}


/**
 * An owner gate that does not say WHAT IS OWED (OR-146).
 *
 * `Gate: owner` parks an entry until the owner acts. It does not say what he is being asked for —
 * a decision, a production write, a reading someone has to take — and those need different things
 * of him. Twenty-five of the seventy-two owner gates measured on 2026-09-24 were the bare field
 * with nothing after it, so establishing what each one owed meant reading the body: 29 lines for
 * `Q-231`, 209 for `Q-1b`. That read is the whole cost of the Orchestrator's primary job, paid
 * again by every session that looks.
 *
 * **What counts as stating it:** anything after `owner` on the same line. This is deliberately a
 * shape check, not a judgement about whether the reason is a GOOD one — the sibling
 * `check-prose-parked-entries.js` records what happens when a detector tries to read intent (a 75%
 * false-positive rate, and it parked the entry describing the bug for three weeks). A one-word
 * reason passes here and a human is still the one who decides it is enough.
 *
 * @param {BacklogEntry[]} entries
 * @returns {BacklogEntry[]}
 */
function bareOwnerGates(entries) {
  return entries.filter((e) => {
    const owner = (e.gateLines || []).filter((l) => /\*{0,2}Gate:\*{0,2}\s*owner/i.test(l));
    if (!owner.length) return false;
    // Stated on ANY of its gate lines is enough — an entry may carry more than one.
    return !owner.some((l) => l.replace(/^.*?owner\*{0,2}/i, '').replace(/^[\s.·:—-]+/, '').trim().length >= 8);
  });
}

/**
 * Entries parked by the legacy prose marker and nothing else (TN-59).
 *
 * An absent `Needs:` target means SHIPPED — the protocol removes a completed entry — so it parks
 * nothing, and must not rescue an entry from this rule either; otherwise a stale `Needs:` becomes a
 * way to silence the check while leaving the entry just as invisible.
 *
 * Lives here rather than in the check so the check and its tests cannot hold two copies of it.
 *
 * @param {BacklogEntry[]} entries  from `parseEntries`
 * @returns {BacklogEntry[]} offenders, in queue order
 */
function proseParkedOnly(entries) {
  const inQueue = new Set(entries.map((e) => e.id));
  return entries.filter(
    (e) => e.legacyBlocked && !e.gates.length && !e.needs.some((n) => inQueue.has(n)),
  );
}

module.exports = {
  bareOwnerGates, parseEntries, parkReasons, proseParkedOnly, NoQueueError };
