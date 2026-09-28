#!/usr/bin/env node
// Prints the next free Postgres migration number and the next free local SQLite schema version,
// counting numbers claimed by branches that have not merged yet. Run it before writing either:
//
//     node scripts/next-schema-number.js          # fetches first; --no-fetch to skip
//
// `ls lib/data/postgres/migrations/ | tail -1` cannot answer this. Numbers are reserved by the
// branch that holds the file, and an open PR's file is not in the merged tree — see
// scripts/lib/migration-claims.js for the incident that makes the point. This replaced a
// hand-maintained table in docs/implementation-backlog.md whose number a CI check pinned to
// max(merged) + 1, so it could only restate what the filenames already said and could never
// reserve ahead of them.
//
// Read-only, and never a CI gate: the number it reports depends on which refs the clone has, and
// CI clones one branch at depth 1. The gate is check-migration-numbers.js, which fails on a
// duplicate in the tree it is given.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { surveyClaims } = require('./lib/migration-claims');

const DIR = 'lib/data/postgres/migrations';
const root = path.join(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const filesIn = (ref) => {
  try {
    return git('ls-tree', '--name-only', `${ref}:${DIR}`).split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

const SQLITE = 'lib/sqlite/migrations.ts';
const worktree = fs.readdirSync(path.join(root, DIR)).filter((f) => f.endsWith('.sql'));

const sqliteVersionsIn = (ref) => {
  let src;
  try {
    src = ref === null ? fs.readFileSync(path.join(root, SQLITE), 'utf8') : git('show', `${ref}:${SQLITE}`);
  } catch {
    return [];
  }
  return [...src.matchAll(/toVersion:\s*(\d+)/g)].map((m) => Number(m[1]));
};

// It fetches by default, and that is not a convenience. A stale remote-tracking ref answers with
// whatever that branch held when you last fetched: writing this script, an un-refreshed ref
// reported #1608 as holding 284/285 — numbers it had been renumbered off — and the wrong pair
// looks exactly as authoritative as the right one.
if (!process.argv.includes('--no-fetch')) {
  try {
    git('fetch', '--quiet', 'origin');
  } catch {
    console.log('next-schema-number: could not fetch — the refs below are as fresh as your last one.\n');
  }
}

let refs = [];
try {
  refs = git('for-each-ref', '--format=%(refname:short)', 'refs/remotes')
    .split('\n')
    .filter((r) => r && !r.endsWith('/HEAD') && r !== 'origin/main');
} catch {
  console.log('next-schema-number: no git refs readable — falling back to the working tree alone.');
}

const merged = filesIn('origin/main');
const base = merged.length ? merged : worktree;
const branches = refs.map((ref) => ({ ref, files: filesIn(ref) }));
// The working tree is a claim like any other — a migration written but not yet committed counts.
branches.push({ ref: 'working tree', files: worktree });

const { next, reserved, collisions } = surveyClaims(base, branches);

console.log(`Next free Postgres migration number: ${next}`);
console.log(
  `  ${base.length} on ${merged.length ? 'origin/main' : 'the working tree'}, ` +
    `${refs.length} other ref(s) read.`,
);
if (reserved.length) {
  console.log('\nClaimed by a branch that has not merged:');
  for (const r of reserved) console.log(`  ${r.num}  ${r.file}  (${r.ref})`);
}
const mainVersions = new Set(sqliteVersionsIn('origin/main'));
const sqliteOnMain = Math.max(0, ...mainVersions);
const sqliteClaims = [{ ref: 'working tree', versions: sqliteVersionsIn(null) }].concat(
  refs.map((ref) => ({ ref, versions: sqliteVersionsIn(ref) })),
);
const sqliteTop = Math.max(sqliteOnMain, ...sqliteClaims.map((c) => Math.max(0, ...c.versions)));
console.log(`\nNext free local SQLite schema version: v${sqliteTop + 1}`);
console.log(`  origin/main tops out at v${sqliteOnMain || '?'}.`);
// A version main does not have — whether above its top or filling a gap it left — is a branch's
// claim. v42 sat in a gap below main's v43 the day this was written, which is the reservation
// working rather than a number going spare.
for (const { ref, versions } of sqliteClaims) {
  const held = [...new Set(versions.filter((v) => !mainVersions.has(v)))].sort((a, b) => a - b);
  if (held.length) console.log(`  claimed elsewhere: v${held.join(', v')}  (${ref})`);
}

if (collisions.length) {
  console.log('\n⚠ Already colliding — two branches claim one number:');
  for (const c of collisions) console.log(`  ${c.num}: ${c.claims.join('  vs  ')}`);
  console.log('  The later branch must renumber; check-migration-numbers.js fails once both are in one tree.');
}
