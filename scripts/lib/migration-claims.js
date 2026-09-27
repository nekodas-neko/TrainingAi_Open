'use strict';
// Who has claimed which Postgres migration number — across branches, not just across filenames.
//
// The number a new migration should take is not `max(merged filenames) + 1`. An unmerged branch
// carrying 286 and 287 is invisible to the merged tree, so deriving from filenames hands the next
// author a number that is already spoken for. That is #1608: an outside contributor derived 284/285
// from what they could see, and 284/285 were taken by a branch that merged first.
//
// Pure so it can be tested without a repository; the git reading lives in next-migration-number.js.

// Already on disk and already applied — each pair is independent, so the ambiguous order is
// harmless and renaming them now would re-run them. Never add to this list to silence a new
// collision: renumber the unmerged migration instead.
const GRANDFATHERED = new Set(['081', '087', '146', '161']);

/** Filenames → the numbers they claim, as { num: [file, …] }. Non-numeric prefixes are ignored. */
function claimsFromFiles(files) {
  const byNumber = new Map();
  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    const num = file.split('/').pop().split('_')[0];
    if (!/^\d+$/.test(num)) continue;
    if (!byNumber.has(num)) byNumber.set(num, []);
    byNumber.get(num).push(file);
  }
  return byNumber;
}

/**
 * @param {string[]} merged        migration filenames on the base branch
 * @param {{ref: string, files: string[]}[]} branches  filenames on each other ref
 * @returns {{ next: string, reserved: {num: string, ref: string, file: string}[],
 *            collisions: {num: string, claims: string[]}[] }}
 */
function surveyClaims(merged, branches) {
  const mergedClaims = claimsFromFiles(merged);
  const owners = new Map(); // num -> [ "main: 284_x.sql", … ]
  const note = (num, where, file) => {
    if (!owners.has(num)) owners.set(num, []);
    owners.get(num).push(`${where}: ${file}`);
  };
  for (const [num, files] of mergedClaims) for (const f of files) note(num, 'merged', f);

  const reserved = [];
  for (const { ref, files } of branches) {
    for (const [num, branchFiles] of claimsFromFiles(files)) {
      for (const file of branchFiles) {
        // A file already on the base branch is the same migration seen twice, not a claim.
        if ((mergedClaims.get(num) ?? []).includes(file)) continue;
        reserved.push({ num, ref, file });
        note(num, ref, file);
      }
    }
  }

  const collisions = [...owners.entries()]
    .filter(([num, claims]) => !GRANDFATHERED.has(num) && new Set(claims.map((c) => c.split(': ')[1])).size > 1)
    .map(([num, claims]) => ({ num, claims }))
    .sort((a, b) => Number(a.num) - Number(b.num));

  const used = [...owners.keys()].map(Number);
  const width = Math.max(3, ...[...owners.keys()].map((n) => n.length));
  const next = used.length
    ? String(Math.max(...used) + 1).padStart(width, '0')
    : String(1).padStart(width, '0');

  return { next, reserved: reserved.sort((a, b) => Number(a.num) - Number(b.num)), collisions };
}

module.exports = { GRANDFATHERED, claimsFromFiles, surveyClaims };
