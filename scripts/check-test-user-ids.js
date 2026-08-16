#!/usr/bin/env node
// Two test files that touch the real database must not share a TEST_USER_ID.
//
// Every DB test in this repo runs against the same `trainingai_dev` (CI: `trainingai_ci`), and
// vitest runs files in parallel workers. Each file's `beforeAll` deletes its own fixture rows —
// `DELETE FROM <table> WHERE user_id = $1` — so two files on the same id delete each other's data
// mid-run, and the loser sees rows that were there a moment ago simply gone.
//
// The blast radius is not one table. Q-177 (2026-08-10) found `push-mutations-complete-workout-hr`
// and `reconcile-counters` both on `…c0de` and both running `DELETE FROM users WHERE id = $1` —
// and **55 of the 58 foreign keys onto `users.id` are ON DELETE CASCADE**, so either file's setup
// wipes the other's entire fixture across ~55 tables. Four such collisions existed across nine
// files.
//
// Mocked tests are exempt because they never open a pool: a file that mocks `@/lib/data` (or the
// pg client) cannot reach a real row, so `user-1` appearing in three route tests is not a
// collision. That exemption is what keeps this check from becoming noise.
//
// This is the cheap half of "DB test isolation". The expensive half — a schema or database per
// vitest worker — is deliberately NOT built: both instabilities actually observed had specific,
// locatable causes (a migration running table-wide, fixed by an advisory lock in Q-171; and this
// id sharing). Neither was "two ordinary suites colliding on rows". Build the per-worker isolation
// when something is observed that these do not explain.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ROOTS = ['app', 'lib', 'packages', 'components'];

// A file that mocks the data layer never acquires a pool, so its ids cannot collide with anything.
const MOCKS_DB = /vi\.mock\(\s*['"]@\/lib\/data(\/postgres\/client)?['"]/;
// Reaching a real row needs one of these.
const TOUCHES_DB = /\b(getPool|getRepositoryAsync|getRepository)\s*\(|pool\.query\(/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'dist'].includes(entry.name)) continue;
      walk(full, out);
      continue;
    }
    if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const byId = new Map();
let scanned = 0;

for (const dir of ROOTS) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }  // skip unreadable/binary
    if (MOCKS_DB.test(src)) continue;
    if (!TOUCHES_DB.test(src)) continue;
    const m = src.match(/const\s+TEST_USER_ID\s*=\s*['"]([^'"]+)['"]/);
    if (!m) continue;
    scanned++;
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (!byId.has(m[1])) byId.set(m[1], []);
    byId.get(m[1]).push(rel);
  }
}

const collisions = [...byId.entries()].filter(([, files]) => files.length > 1);

if (collisions.length > 0) {
  console.error('Two DB-touching test files share a TEST_USER_ID (Q-177).');
  console.error("They run in parallel workers and each one's `DELETE … WHERE user_id` removes the other's fixture.");
  console.error('Give one of them an unused id:');
  for (const [id, files] of collisions) {
    console.error(`  ${id}`);
    for (const f of files) console.error(`    ${f}`);
  }
  process.exit(1);
}

console.log(`check-test-user-ids: ${scanned} DB-touching test file(s) with a TEST_USER_ID, all distinct.`);
