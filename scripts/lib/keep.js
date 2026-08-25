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

/** The Keep residue for one entry's lines, or null if it states none. */
function keepFromLines(lines) {
  for (let i = 0; i < lines.length; i++) {
    // The colon is REQUIRED. Without it this matched prose beginning with the word — Q-420's
    // "**Keep the stored field on 1–10**" was reported as its residue while its actual
    // `- **Keep:**` bullet sat further down the entry.
    const m = lines[i].match(/^\s*(?:[-*]\s*)?\*{0,2}Keep:\*{0,2}\s*(.+)$/i);
    if (!m) continue;
    // A Keep wraps across lines; its gate can sit on any of them, up to the next bullet.
    let text = m[1];
    const block = [lines[i]];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*(?:[-*]\s|#|>)/.test(lines[j]) || !lines[j].trim()) break;
      block.push(lines[j]);
      text += ' ' + lines[j].trim();
    }
    const gate = block.join(' ').match(/Gate:\s*`?\*{0,2}(owner|device)/i);
    return {
      text: text.replace(/\s+/g, ' ').replace(/\*\*/g, '').trim(),
      gate: gate ? gate[1].toLowerCase() : null,
    };
  }
  return null;
}

module.exports = { keepFromLines };
