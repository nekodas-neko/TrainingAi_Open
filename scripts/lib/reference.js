'use strict';
//
// An entry that exists to be READ by other entries, not implemented.
//
// The queue holds two kinds of thing. Most rows are work. A few are maps: BF-28 says
// "⚑ Not implementable on its own. This is the entry the per-screen parity entries read", and BF-11
// says "Not a work item." They live in the queue on purpose — deleting them would scatter the rules
// six entries re-derive — but `next-item.js` had no notion of them, so BF-28 printed as READY #1
// under a header that says "top of the list is next". Three sessions in a row opened the queue and
// met a row that cannot be started, which is the exact failure the tool exists to prevent.
//
// **Why a field rather than grepping those two sentences.** `Lane:`, `Needs:`, `Gate:` and `Keep:`
// are fields precisely because prose-detection loses: a third phrasing appears and the tool silently
// goes back to mis-sorting. `next-item.js` already treats the `⛔` prose marker as an *unmigrated*
// state for the same reason. So the marker is `- **Reference:** <why>`, validated by
// `check-backlog-pointers.js`, and the prose stays in the body where it carries the detail.
//
// A Reference is NOT a park. It is not blocked and it is not waiting on anyone — it is simply not
// work, and it needs to stay findable, which is why it prints in its own section rather than being
// filtered out. An implementer should be able to see the map exists without it heading the list.

/** The Reference note for one entry's lines, or null if it states none. */
function referenceFromLines(lines) {
  for (const line of lines) {
    // Colon-or-dash, matching `keepFromLines` — TN-3a and TN-4 write `- **Keep — …:**`, and the same
    // hand will eventually write `- **Reference — …:**`. Anchored at a bullet so a sentence that
    // merely uses the word ("see the reference doc") cannot claim the field.
    const m = line.match(/^\s*[-*]\s*\*{0,2}Reference(?::\*{0,2}|\s*[—–-])\s*(.+)$/i);
    if (!m) continue;
    return m[1].replace(/\s+/g, ' ').replace(/\*\*/g, '').trim();
  }
  return null;
}

/**
 * The self-declared prose markers this field replaces.
 *
 * Kept here rather than in the checker so the parser and the ratchet cannot disagree about what
 * counts — the drift that put a lane rule in two files and let them diverge within a day.
 */
const PROSE_MARKERS = [
  'Not implementable on its own',
  'Not a work item',
];

/**
 * True when an entry DECLARES itself unbuildable in prose. Used to require the field beside it.
 *
 * **Anchored at the start of a bullet, not a substring match anywhere on the line.** The first draft
 * used `includes` and immediately flagged LB-22 — the entry that *describes* these two markers, in
 * quotes, while proposing the field. An entry discussing the convention is not claiming it, and a
 * checker that cannot tell those apart is the prose-detection failure this field exists to end.
 * Both real cases write it as the first thing in the bullet: `- **⚑ Not implementable on its own.**`
 * and `- **Not a work item.**`.
 */
function hasProseMarker(lines) {
  return lines.some((l) => {
    const m = l.match(/^\s*[-*]\s*\*{0,2}(?:⚑\s*)?(.*)$/);
    return !!m && PROSE_MARKERS.some((marker) => m[1].startsWith(marker));
  });
}

module.exports = { referenceFromLines, hasProseMarker, PROSE_MARKERS };
