'use strict';
//
// What is still owed on an entry that has already shipped.
//
// The protocol removes a completed entry from the queue, but an entry that shipped its code and
// still owes an owner sign-off or a device smoke run stays, stating the residue with
// `- **Keep:** <what is owed>`. That is the correct thing for it to do — deleting it would lose the
// obligation — but to `next-item.js` those entries were indistinguishable from unstarted work, so
// they sat at the top of the queue under their original (high) priority. Measured 2026-08-25:
// **17 of Lane B's top 21 READY entries had shipped**, which put the 53 genuinely unstarted ones
// below the fold of a tool whose entire job is to answer "what can I start now".
//
// A Keep is NOT a block — the residue is often real work, and hiding it would repeat the mistake in
// the other direction. It is its own bucket, printed with what it owes.
//
// The `Gate:` field is read from anywhere on the Keep's lines, not only from a bullet that starts
// with it: entries write `` … the sheet's action row carries Remove. `Gate: device`. `` inline, and
// the leading-bullet form matched 20 of the 27 `Gate:` mentions in the file.
//
// **LA-103. Reading it from ANYWHERE meant a sentence ABOUT a gate was read as one.** BF-46's Keep
// said *"**The `Gate: device` above was deliberately withheld while they were unbuilt**"* — a
// sentence denying a gate — and it was parsed as asserting one. That was masked for weeks by
// `next-item.js` skipping a Keep's gate when the entry also carried `Verify:` for the same value;
// the owner's 2026-09-13 sign-off removed the `Verify:`, un-masked the phantom, put a VERIFIED entry
// back into PARKED and turned `main` red. The repo's own recurring class: guards find their own
// documentation.
//
// **The fix is `GATE_IS_SET_OFF`, and it is what the measurement supports rather than what the
// entry guessed.** LA-103 hypothesised "a mention preceded by a word character is prose" from that
// single case. Measured across all 164 Keep blocks, 18 yield a gate — and **LB-53 refutes it**:
// *"running it is a **`Gate: owner`** action"* is preceded by the word "a" and is a real gate. What
// separates them is that a field is SET OFF from the prose — it opens a clause (17 of the 18 follow
// a full stop) or it is bolded (LB-53 and BF-80) — while a mention inside a sentence is not.
//
// Anchoring to a bullet start instead, the obvious fix, would have dropped all 18 and silently
// un-parked genuinely blocked work, which is worse than the bug.

/**
 * A `Gate:` that is SET OFF from the prose rather than mentioned inside a sentence — see the note
 * above. Everything before the token, after an optional backtick, decides it: bold (`**`), a clause
 * boundary, or nothing at all means a field; a word character means the sentence is talking ABOUT a
 * gate. Returns the matched value, or null when every mention in the text is prose.
 */
function matchSetOffGate(text) {
  const re = /(.{0,4}?)`?\*{0,2}Gate:\s*`?\*{0,2}(owner|device)/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // What sits immediately before the token, with a backtick of its own stripped off.
    const before = text.slice(0, m.index + m[1].length).replace(/`$/, '').trimEnd();
    if (before === '' || /(\*\*|[.;:—–-])$/.test(before)) return m[2].toLowerCase();
  }
  return null;
}

/** The Keep residue for one entry's lines, or null if it states none. */
function keepFromLines(lines) {
  // An entry that has shipped often opens with a blockquote banner and states its residue inside
  // it, so the `- **Keep:**` bullet arrives prefixed with `> `. Neither the match below nor the
  // continuation loop (which BREAKS on a `>`) could see through that, so BF-67 and BF-81 read as
  // unstarted work at the top of Lane A's READY list the day after they shipped — the exact
  // failure this file was written to end. Stripping the marker first fixes both halves at once:
  // the bullet matches, and the wrapped lines under it are no longer their own quote block.
  lines = lines.map((l) => l.replace(/^\s*>+\s?/, ''));
  for (let i = 0; i < lines.length; i++) {
    // `Keep` must be followed by a colon or a dash. Without that punctuation this matched prose
    // beginning with the word — Q-420's "**Keep the stored field on 1–10**" was reported as its
    // residue while its actual `- **Keep:**` bullet sat further down the entry. The dash form is
    // not decoration: TN-3a and TN-4 write `- **Keep — what is NOT done:**`, and a colon-only
    // match read both as unstarted work and put them at the top of Lane A's READY list. Those two
    // and the eight prose false-positives are the whole population — measured 2026-08-25 over all
    // 196 entries, which is why this is punctuation and not a word list.
    // `[^\w\n]{0,3}` after the asterisks: four real Keeps open `- **⚠ Keep:` and none of them
    // parsed, so four shipped entries read as unstarted — the exact failure above, wearing a
    // warning sign. Measured over all 144 Keep bullets in the file: 140 matched, and the 4 that did
    // not were all that shape. Non-word only, so a prefix containing a letter (Q-420's
    // "**Keep the stored field on 1–10**", or any "The Keep:" in prose) still cannot reach it.
    const m = lines[i].match(/^\s*(?:[-*]\s*)?\*{0,2}[^\w\n]{0,3}Keep(?::\*{0,2}|\s*[—–-])\s*(.+)$/i);
    if (!m) continue;
    // A Keep wraps across lines; its gate can sit on any of them, up to the next bullet.
    let text = m[1];
    const block = [lines[i]];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*(?:[-*]\s|#|>)/.test(lines[j]) || !lines[j].trim()) break;
      block.push(lines[j]);
      text += ' ' + lines[j].trim();
    }
    // Per LINE, not on the joined block: a bare `Gate: device` opening a continuation line is set off
    // by the line break itself, and joining with a space would hide that behind the previous
    // sentence's last word.
    let gate = null;
    for (const line of block) {
      gate = matchSetOffGate(line);
      if (gate) break;
    }
    return {
      text: text.replace(/\s+/g, ' ').replace(/\*\*/g, '').trim(),
      gate,
    };
  }
  return null;
}

module.exports = { keepFromLines };
