'use strict';
//
// An entry whose deliverable is an ANSWER FROM THE OWNER (BF-194).
//
// CLAUDE.md's rule is that a question for the owner becomes a task at `Lane: O`, ungated, "near the
// top of the queue". **Position is the wrong mechanism and it failed the day it was written.**
// Measured 2026-09-24: BF-189 and BF-191 were filed at ranks 1 and 2 one evening and sat at 16 and
// 17 the next morning — fourteen entries inserted above them within about eight hours. No agent
// misbehaved; every agent files at the head, which is what the convention asks for, so the head is
// exactly where the churn is. `next-item.js` prints `TOP_N = 10`, so the questions were invisible.
//
// **BF-194 recommended keying the section on `Lane: O` and that does not work — measured before
// building it.** Lane O holds **61 entries, 58 of them ungated**, because it is the Orchestrator's
// whole lane and not a queue of questions. A section on that key prints the lane, which is what
// `--all` already does and is the failure it was meant to fix. The entry also rejected a field on
// the grounds that "`Lane: O` already identifies them"; that premise is the thing the measurement
// refutes, so the field is back.
//
// **The field must NOT park.** `Gate: owner` is the trap this rule already records: it removes an
// entry from the Orchestrator's own READY list, so gating a question on the owner is what stops
// anyone asking it. `Ask:` is the mirror — pure visibility, no blocking semantics. An entry carrying
// it is MORE visible, never less, and it keeps whatever other fields it has.
//
// Why a field rather than matching prose: the same argument `reference.js` makes. `Lane:`, `Needs:`,
// `Gate:` and `Keep:` are fields because prose detection loses — a third phrasing appears and the
// tool silently mis-sorts. The eight owner questions live in the queue today with no shared token
// in their titles; there is nothing to grep.

/** The Ask note for one entry's lines, or null if it states none. */
function askFromLines(lines) {
  for (const line of lines) {
    // Colon-or-dash and bullet-anchored, matching `referenceFromLines` — so a sentence that merely
    // uses the word ("ask him about the anchor") cannot claim the field.
    // Deliberately looser than `referenceFromLines` in one place: the bold may CLOSE before the
    // separator (`- **Ask** — owner: …`), which that regex misses. A missed Reference prints an
    // entry in the wrong section; a missed Ask leaves an owner question invisible, which is the
    // whole failure this field exists for, so the shapes are not worth keeping identical.
    const m = line.match(/^\s*[-*]\s*\*{0,2}Ask\*{0,2}(?::\*{0,2}|\s*[—–-])\s*(.+)$/i);
    if (!m) continue;
    const note = m[1].replace(/\s+/g, ' ').replace(/\*\*/g, '').trim();
    return note === '' ? null : note;
  }
  return null;
}

module.exports = { askFromLines };
