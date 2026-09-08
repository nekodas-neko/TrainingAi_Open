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

const LANE_FIELD_RE = /\*{0,2}Lane:\*{0,2}\s*\*{0,2}(A\b|B\b|O\b|\?)/;
const LANE_LOOSE_RE = /\*{0,2}Lane:?\*{0,2}\s*\*{0,2}(A\b|B\b|O\b|\?)/;

/**
 * @returns `'A'` · `'B'` · `'O'` · `'?'` · or `null` for "not stated".
 *
 * `'O'` is the Orchestrator's own lane, added 2026-09-06 (OR-103). It exists because CI config,
 * workflow files and repository settings are in NEITHER implementer lane's paths, so §3's path rule
 * cannot answer them and they printed as UNCLASSIFIED forever — four of them at once, each saying
 * "neither lane" in prose. A label that lives only in prose is the defect this whole file exists
 * for, so the third value is the consistent fix rather than a special case.
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

/**
 * The offending text when a line DECLARES a `Lane:` field the reader above cannot read, else null.
 *
 * LB-59. `LANE_FIELD_RE` needs a word boundary after the letter, so `**Lane:** O` classifies and
 * **`**Lane:** Orchestrator` does not** — the `O` is followed by `r`. An unmatched field returns
 * `null` from `laneFromLines`, which the caller reads as "unstated, so the path rule answers it",
 * and the entry then prints in BOTH implementer lanes' READY lists. PS-38 sat at the top of Lane B's
 * READY list for a day on exactly that, and a Lane B session picked up work that was nobody's.
 *
 * Printing in both lists is the SAFE failure and stays — a version that hid an unmatched entry took
 * 96 of 203 out of both lanes at once. What this adds is a signal at the point of WRITING, which is
 * the only place the mistake is cheap: the check fails exactly when the reader cannot read the
 * value, so the two can never disagree about what counts as valid.
 *
 * Only the FIELD form is judged. Three quarters of the queue names its lane bare (`— Lane A`,
 * `**Lane B**`) and prose mentions one constantly; both are read loosely on purpose and neither is
 * a declaration. Anchoring at the bullet is what makes the other exemptions free: a doc example
 * (`` - `**Lane:** <letter>` ``) and a struck-through, superseded line (`- ~~**Lane:** X~~`) both put
 * a character before the field name and so never match. An explicit `~~` guard was written first and
 * a mutation test showed it changed nothing — worse, it would have let a HALF-struck live value
 * (`- **Lane:** ~~O~~ B`) through unflagged.
 */
function laneFieldProblem(line) {
  if (!/^\s*[-*]\s*\*{0,2}Lane:/.test(line)) return null;
  if (LANE_FIELD_RE.test(line)) return null;
  const value = line.replace(/^\s*[-*]\s*\*{0,2}Lane:\*{0,2}\s*/, '').trim();
  return value === '' ? '(empty)' : value.slice(0, 60);
}

module.exports = { laneFromLines, laneFieldProblem, LANE_FIELD_RE, LANE_LOOSE_RE };
