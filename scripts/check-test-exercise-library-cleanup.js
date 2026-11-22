#!/usr/bin/env node
// A test that inserts into the shared exercise_library also deletes from it.
//
// #4038: a test left a library row behind in a table every other DB test reads, and a later test's
// library scan broke on it for a reason that had nothing to do with that test. A file that writes
// to exercise_library (raw SQL `INSERT INTO exercise_library`, or Drizzle `insert(exerciseLibrary)`)
// must also contain a delete from it (`DELETE FROM exercise_library` / `delete(exerciseLibrary)`),
// so the cleanup is at least in the same file at review time.
//
// This checks that a delete exists, not that it runs or that it names the right row; the proof a
// file cleans up is the library query in docs/local-dev-database.md after the file's runs.
// Comments are stripped first so prose quoting the pattern is not matched.
'use strict';
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./lib/strip-comments');

const root = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage', 'android', 'ios']);
const TEST_FILE = /(\.test|\.spec)\.(ts|tsx|js|mjs)$/;

const EXEMPT = new Map([
  // Its own throwaway database (CREATE DATABASE ... dropped in afterAll) with a hand-made
  // exercise_library table; nothing reaches the shared one.
  ['lib/data/postgres/__tests__/la143-backfill-exercise-ids.test.ts', 'inserts into a probe database it drops in afterAll'],
  // Removes its library rows in afterAll by id, through the generic createdCatalogue loop
  // (DELETE FROM public."<table>" WHERE "id" = ...), which this text scan cannot see.
  ['lib/data/postgres/__tests__/repository-ownership-scoping-sweep.test.ts', 'deletes by id through the generic createdCatalogue loop'],
]);

const INSERT = /INSERT\s+INTO\s+(?:public\.)?"?exercise_library\b|\binsert\(\s*exerciseLibrary\s*\)/i;
const DELETE = /DELETE\s+FROM\s+(?:ONLY\s+)?(?:public\.)?"?exercise_library\b|\bdelete\(\s*exerciseLibrary\s*\)/i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out);
    } else if (TEST_FILE.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

const failures = [];
for (const file of walk(root)) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  if (INSERT.test(src) && !DELETE.test(src) && !EXEMPT.has(rel)) failures.push(rel);
}

if (failures.length) {
  console.error('These test files insert into exercise_library and never delete from it:');
  for (const f of failures) console.error(`  ${f}`);
  console.error('Delete the row by its exact name before inserting and in afterAll (#4038, #4040).');
  process.exit(1);
}
console.log('check-test-exercise-library-cleanup: every test that inserts into exercise_library also deletes from it');
