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
  const loose = [];
  for (const line of lines) {
    const f = line.match(LANE_FIELD_RE);
    if (f && field === null) field = f[1].trim();
    const l = line.match(LANE_LOOSE_RE);
    if (l) loose.push(l[1].trim());
  }
  if (field !== null) return field;
  if (loose.length === 0) return null;

  // No field form, and the bare mentions disagree — so one of them is prose and there is no way to
  // tell which. Measured 2026-08-20: 19 entries were in this state, and EIGHT of Lane A's top ten
  // READY items were among them, because a banner reading "the Lane A half SHIPPED, what is left is
  // Lane B" put an `A` ahead of the real tag. Taking the first was a coin toss dressed as an answer.
  //
  // `?` is what the tool already means by "I could not tell": it surfaces to a human instead of
  // being filtered away. Refusing to guess is the whole point — a wrong lane sends work to the wrong
  // agent silently, which is strictly worse than admitting the entry needs a tag.
  if (new Set(loose).size > 1) return '?';
  return loose[0];
}

module.exports = { laneFromLines, LANE_FIELD_RE, LANE_LOOSE_RE };
