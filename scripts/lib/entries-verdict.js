'use strict';
//
// Who pays for the journal directory growing past its limit.
//
// BF-36: the runaway limit used to fail whichever PR happened to be open when the count crossed,
// which is unrelated to whoever grew the directory. Every session writes a journal entry, so the
// cost fell at random — it blocked PR #527, a docs-only intake whose diff the failure named none
// of, and the resolution was not the sweep but merging `main`, because another session had swept
// concurrently. That PR paid a CI cycle and a diagnosis for a condition it neither caused nor fixed.
//
// The threshold is right and the chore is real; only the targeting was wrong. A PR that adds an
// entry while the directory is over the limit IS the growth, and its author is already touching the
// directory. A PR that adds none gets the note that already exists for "sweep it when convenient".
//
// Extracted from the check so the two cases can be driven against a fixture rather than the live
// directory — a test that reads the real count would change verdict as the repo does, which is the
// one thing a regression test for a counting rule must not do.

/**
 * @param {object} o
 * @param {number} o.total        every .md in the directory except its README
 * @param {number} o.unlinked     those no durable doc cites — the foldable ones
 * @param {number|null} o.addedHere  entries THIS BRANCH adds, or null when the base is unreadable
 * @param {number} o.chore        note at or above this many foldable
 * @param {number} o.limit        fail above this many foldable, when this branch grew it
 * @param {number} o.totalCeiling fail above this many total, regardless
 * @param {string} o.dir          for the message
 * @returns {{ level: 'fail'|'note'|'ok', message: string }}
 */
function entriesVerdict({ total, unlinked, addedHere, chore, limit, totalCeiling, dir }) {
  const linked = total - unlinked;
  // `null` means we cannot see the base — a shallow clone, an export. Attribution is impossible, so
  // keep the old behaviour rather than letting an unreadable base silence the limit entirely.
  const grewIt = addedHere === null || addedHere > 0;

  if (unlinked > limit && grewIt) {
    const because = addedHere === null
      ? `      The base branch could not be read, so this cannot be attributed — treating it as yours.\n`
      : `      This branch adds ${addedHere} of them, so the sweep is yours: you are already here.\n`;
    return {
      level: 'fail',
      message:
        `${dir}/ holds ${unlinked} foldable entries, over the ${limit} runaway limit\n` +
        `      (${total} total; ${linked} are linked by a durable doc and must NOT be folded).\n` +
        because +
        `      Run the compaction sweep in ${dir}/README.md: fold the UNLINKED ones oldest-first\n` +
        `      into a batched docs/overview/history-*.md, rewriting the relative links in each body,\n` +
        `      then git rm the folded files.`,
    };
  }

  if (total > totalCeiling) {
    return {
      level: 'fail',
      message:
        `${dir}/ holds ${total} entries, over the ${totalCeiling} total ceiling — it has\n` +
        `      stopped being a readable recent-window. Only ${unlinked} are foldable, so a sweep\n` +
        `      alone will not fix this: the durable docs citing the other ${linked} need to point at\n` +
        `      the batched history instead.`,
    };
  }

  if (unlinked > limit) {
    return {
      level: 'note',
      message:
        `${dir}/ holds ${unlinked} foldable entries, over the ${limit} runaway limit ` +
        `(${total} total, ${linked} linked) — but this branch adds none, so it is not yours to fix. ` +
        `The next PR that adds an entry runs the sweep.`,
    };
  }

  if (unlinked >= chore) {
    return {
      level: 'note',
      message:
        `${dir}/ holds ${unlinked} foldable entries (${total} total, ${linked} linked), at or over ` +
        `the ${chore}-file compaction chore threshold. Not a failure; sweep it when convenient.`,
    };
  }

  return { level: 'ok', message: '' };
}

module.exports = { entriesVerdict };
