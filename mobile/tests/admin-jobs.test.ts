import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import {
  adminJobs,
  canWrite,
  jobFailure,
  jobQuery,
  rangeProblem,
  remainingOf,
  summaryRows,
} from '../src/features/admin/data/admin-jobs.ts';

const none = { from: '', to: '' };

test('every job points at a route that exists and takes dryRun', () => {
  for (const job of adminJobs) {
    const file = new URL(`../..${job.path.replace('/api/', '/app/api/')}/route.ts`, import.meta.url);
    assert.ok(existsSync(file), job.path);
    assert.match(readFileSync(file, 'utf8'), /dryRun/, job.path);
  }
});

test('jobs the owner retired on #2862 are not offered', () => {
  const retired = ['rederive-body-battery', 'rederive-baselines', 'stress-backfill', 'baseline-phase-tag', 'app-load-report', 'vacuum', 'pack'];
  for (const job of adminJobs)
    for (const r of retired) assert.ok(!job.path.includes(r), `${job.path} / ${r}`);
});

test('only an explicit write asks for dryRun=false; everything else is a dry run', () => {
  assert.deepEqual(jobQuery({ range: 'none' }, none, false), { dryRun: 'true' });
  assert.deepEqual(jobQuery({ range: 'none' }, none, true), { dryRun: 'false' });
  assert.deepEqual(jobQuery({ range: 'required' }, { from: '2026-09-01', to: '2026-09-30' }, false), {
    dryRun: 'true',
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.deepEqual(jobQuery({ range: 'optional' }, none, true), { dryRun: 'false' });
});

test('date ranges: both dates, in order, at most 31 days; optional may be empty', () => {
  assert.equal(rangeProblem({ range: 'none' }, none), null);
  assert.equal(rangeProblem({ range: 'optional' }, none), null);
  assert.ok(rangeProblem({ range: 'required' }, none));
  assert.ok(rangeProblem({ range: 'optional' }, { from: '2026-09-01', to: '' }));
  assert.ok(rangeProblem({ range: 'required' }, { from: '2026-02-30', to: '2026-03-02' }));
  assert.ok(rangeProblem({ range: 'required' }, { from: '2026-09-10', to: '2026-09-01' }));
  assert.equal(rangeProblem({ range: 'required' }, { from: '2026-10-01', to: '2026-10-31' }), null);
  assert.ok(rangeProblem({ range: 'required' }, { from: '2026-10-01', to: '2026-11-01' }));
});

test('a write is locked until a server-confirmed dry run, the same dates, the snapshot and the word', () => {
  const dry = { dryRun: true, summary: {} };
  const p = { from: '2026-09-01', to: '2026-09-30' };
  const ready = { dry, dryParams: p, params: p, snapshot: true, typed: 'WRITE' };
  assert.equal(canWrite(ready), true);
  assert.equal(canWrite({ ...ready, dry: null }), false);
  assert.equal(canWrite({ ...ready, dry: { dryRun: false } }), false, 'a report that was not a dry run never unlocks');
  assert.equal(canWrite({ ...ready, dryParams: null }), false);
  assert.equal(canWrite({ ...ready, params: { ...p, to: '2026-09-29' } }), false, 'changed dates need a new dry run');
  assert.equal(canWrite({ ...ready, snapshot: false }), false);
  assert.equal(canWrite({ ...ready, typed: 'write' }), false);
  assert.equal(canWrite({ ...ready, typed: '' }), false);
});

test('the summary reads as rows, one nesting level flattened', () => {
  const rows = summaryRows({ summary: { wouldWrite: 118, medianMovePct: null, sleep: { written: 2, unchanged: 5 }, list: [1], deep: { a: { b: 1 } } } });
  assert.deepEqual(rows, [
    { label: 'wouldWrite', value: '118' },
    { label: 'medianMovePct', value: 'null' },
    { label: 'sleep.written', value: '2' },
    { label: 'sleep.unchanged', value: '5' },
  ]);
  assert.deepEqual(summaryRows(null), []);
  assert.equal(remainingOf({ summary: { remaining: 12 } }), 12);
  assert.equal(remainingOf({ summary: {} }), 0);
});

test('failures say nothing was written only when the server said so', () => {
  assert.match(jobFailure({ status: 429 }), /Wait a minute/);
  assert.match(jobFailure({ status: 400 }), /Nothing was written/);
  assert.doesNotMatch(jobFailure(new Error('timeout')), /^Nothing was written/);
  assert.match(jobFailure(new Error('timeout')), /dry run again/);
});

test('the typed word is the same one the panel shows', () => {
  const card = readFileSync(new URL('../src/features/admin/components/AdminJobCard.tsx', import.meta.url), 'utf8');
  assert.ok(card.includes('WRITE_PHRASE'));
});
