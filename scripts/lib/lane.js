//
// Which lane a backlog entry states it belongs to.
//
// A lane can be written as a field (`**Lane:** B`) or bare (`— Lane A`, `**Lane B**`). Both are read:
// 75 of 205 entries use the bare form, so requiring the colon would unclassify a third of the queue.
// But the FIELD form wins wherever an entry has one, so an entry's PROSE can never outrank its own
// tag — which is the defect this file exists for.
//
// Measured 2026-08-20, with first-match-wins: **Q-529 was being served to Lane A** while its own body
// said "Re-scoped from Lane A to Lane B" fourteen lines above `**Lane:** B`. The prose mention won.
// Q-421 hit the same thing the moment it was handed over — its shipped-banner read "(Lane A)".
'use strict';

const LANE_FIELD_RE = /\*{0,2}Lane:\*{0,2}\s*\*{0,2}(A\b|B\b|\?)/;
const LANE_LOOSE_RE = /\*{0,2}Lane:?\*{0,2}\s*\*{0,2}(A\b|B\b|\?)/;

/**
 * @returns `'A'` · `'B'` · `'?'` · or `null` for "not stated".
 *
 * `null` is not "hidden": the caller reads it as visible to BOTH lanes, because an unstated lane is
 * answered by the path rule in `docs/agents/README.md` §3 rather than by this file.
 *
 * The accumulators start at `null` for that reason, and it is the initialisation rather than the
 * trailing `?? null` that guarantees it — the fallback is belt-and-braces, and a mutation test
 * confirms removing it changes nothing here. **The distinction is not academic:** the caller in
 * `next-item.js` accumulates into `undefined` instead, and a version of this that let `undefined`
 * through hid 96 of 203 entries from both lanes at once.
 */
function laneFromLines(lines) {
  let field = null;
  let loose = null;
  for (const line of lines) {
    const f = line.match(LANE_FIELD_RE);
    if (f && field === null) field = f[1].trim();
    const l = line.match(LANE_LOOSE_RE);
    if (l && loose === null) loose = l[1].trim();
  }
  return field ?? loose ?? null;
}

module.exports = { laneFromLines, LANE_FIELD_RE, LANE_LOOSE_RE };
