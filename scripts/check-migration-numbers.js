#!/usr/bin/env node
// Fails when two Postgres migrations claim the same leading number. `migrate.js` applies in
// plain filename sort order, so a duplicate number makes apply order ambiguous between the two
// files — and `schema_migrations` tracks by filename, so neither can be renamed once applied.
// Parallel sessions collide here exactly the way they collide on Q numbers: both read `main`,
// both pick the next free number, both land.
'use strict';
const fs = require('fs');
const path = require('path');

const { GRANDFATHERED } = require('./lib/migration-claims');

const dir = path.join(__dirname, '..', 'lib', 'data', 'postgres', 'migrations');
const byNumber = new Map();
for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith('.sql')) continue;
  const num = file.split('_')[0];
  if (!/^\d+$/.test(num)) {
    console.error(`check-migration-numbers: ${file} does not start with a numeric prefix`);
    process.exit(1);
  }
  if (!byNumber.has(num)) byNumber.set(num, []);
  byNumber.get(num).push(file);
}

const collisions = [...byNumber.entries()]
  .filter(([num, files]) => files.length > 1 && !GRANDFATHERED.has(num));

if (collisions.length > 0) {
  console.error('Duplicate Postgres migration number(s) — apply order is ambiguous and a migration cannot be renamed once applied.');
  console.error('Renumber the unmerged migration to the next free number (claim it against BOTH the directory and open PRs):');
  for (const [num, files] of collisions) console.error(`  ${num}: ${files.join(', ')}`);
  process.exit(1);
}

console.log(
  `check-migration-numbers: ${byNumber.size} numbers, no new collisions. ` +
    'For the next free number run `node scripts/next-schema-number.js`, which also sees ' +
    'numbers claimed by branches that have not merged.',
);
