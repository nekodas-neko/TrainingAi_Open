'use strict';
// Who has claimed which Postgres migration number — across branches, not just across filenames.
//
// The number a new migration should take is not `max(merged filenames) + 1`. An unmerged branch
// carrying 286 and 287 is invisible to the merged tree, so deriving from filenames hands the next
// author a number that is already spoken for. That is #1608: an outside contributor derived 284/285
// from what they could see, and 284/285 were taken by a branch that merged first.
//
// Pure so it can be tested without a repository; the git reading lives in next-schema-number.js.

// Already on disk and already applied — each pair is independent, so the ambiguous order is
// harmless and renaming them now would re-run them. Never add to this list to silence a new
// collision: renumber the unmerged migration instead.
const GRANDFATHERED = new Set(['081', '087', '146', '161']);

// BF-214 deleted the 59 `claude_ro` view migrations, the newest of them 289. Production has every one
// of those filenames recorded, so a number up to here names two different files in two places. The
// next number never drops below this floor, whatever the directory's highest file happens to be.
const RETIRED_FLOOR = 289;

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
 * @param {number} [floor]  `next` never goes below `floor + 1` — see RETIRED_FLOOR
 * @param {Date} [now]  when given, `next` is a UTC `YYYYMMDDHHMM` timestamp (BF-214 ②) — or one past
 *                      the highest claim, if a claim is already at or beyond this minute
 * @returns {{ next: string, reserved: {num: string, ref: string, file: string}[],
 *            collisions: {num: string, claims: string[]}[] }}
 */
function surveyClaims(merged, branches, floor = RETIRED_FLOOR, now) {
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
  const afterClaims = Math.max(floor, ...used) + 1;
  const next = now
    ? String(Math.max(Number(minuteStamp(now)), afterClaims))
    : String(afterClaims).padStart(width, '0');

  return { next, reserved: reserved.sort((a, b) => Number(a.num) - Number(b.num)), collisions };
}

/**
 * A migration prefix for this minute, in UTC: `YYYYMMDDHHMM`. Two authors collide only by picking the
 * same minute, where a sequential number collided whenever two branches were open at once. The
 * appliers order by the leading INTEGER (sortMigrationFiles), so this sorts after every `NNN_` file.
 * UTC on purpose: it is an ordering key, not a date anyone reads as their day.
 */
function minuteStamp(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
}

// BF-214 ① deleted every `claude_ro_views` migration; the views are one generated file now, and
// `claude-ro-views-file.test.ts` fails any PR that adds such a migration. So a branch still holding
// one is stale, not a claim, and it cannot be a live collision.
const DEAD_PATTERN = /_claude_ro_views(_[^/]*)?\.sql$/;

/**
 * OR-202. `surveyClaims`' lists, made readable: one line per (number, file) however many branches
 * hold it, and nothing for the dead `claude_ro_views` pattern. Before this, a single run printed
 * 470 KB, and number 274 alone named the same file on 44 branches. A real collision sat between two
 * paragraphs of that noise.
 *
 * @returns {{ reserved: {num: string, file: string, refs: string[]}[],
 *             collisions: {num: string, files: {file: string, refs: string[]}[]}[],
 *             deadRefs: number }}
 */
function summariseClaims({ reserved, collisions }) {
  const dead = new Set();
  const groups = new Map();
  for (const r of reserved) {
    if (DEAD_PATTERN.test(r.file)) { dead.add(r.ref); continue; }
    const key = `${r.num}|${r.file}`;
    if (!groups.has(key)) groups.set(key, { num: r.num, file: r.file, refs: [] });
    groups.get(key).refs.push(r.ref);
  }
  const live = [];
  for (const c of collisions) {
    const byFile = new Map();
    for (const claim of c.claims) {
      const cut = claim.indexOf(': ');
      const where = claim.slice(0, cut);
      const file = claim.slice(cut + 2);
      if (DEAD_PATTERN.test(file)) { if (where !== 'merged') dead.add(where); continue; }
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(where);
    }
    if (byFile.size > 1) live.push({ num: c.num, files: [...byFile].map(([file, refs]) => ({ file, refs })) });
  }
  return { reserved: [...groups.values()], collisions: live, deadRefs: dead.size };
}

/** `origin/a, origin/b +3 more` — enough to act on without printing all of them. */
function refList(refs, show = 2) {
  return refs.length <= show ? refs.join(', ') : `${refs.slice(0, show).join(', ')} +${refs.length - show} more`;
}

module.exports = { GRANDFATHERED, RETIRED_FLOOR, DEAD_PATTERN, claimsFromFiles, surveyClaims, summariseClaims, refList, minuteStamp };
