import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withLocalDoses, type TimelineEvent } from '../src/features/home/data/timeline.ts';
import { timelineCardContent } from '../src/features/home/data/timeline-presentation.ts';

// #2185 option A: a dose on Home's timeline, from the server and from an unsynced tick.
const TZ = 'Australia/Brisbane';
const TODAY = '2026-09-08';
const at = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00+10:00`);
const server: TimelineEvent = {
  type: 'dose',
  time: '8:15 am',
  timeMs: at(TODAY, '08:15'),
  title: 'Dose · 2 mg',
  subtitle: 'Week 6 of this vial · 3 doses left',
  day: 'today',
  date: TODAY,
  supplementId: 'sup-1',
  logDate: TODAY,
};
const tick = (payload: Record<string, unknown>, date = TODAY) => ({
  domain: 'supplement_logs',
  date,
  payload: { supplementId: 'sup-1', logDate: date, ...payload },
});

test('an unsynced dose is on the timeline at once, title alone', () => {
  const [row] = withLocalDoses(
    [],
    [
      tick({
        amount: 2,
        unit: 'mg',
        takenAt: new Date(at(TODAY, '09:00')).toISOString(),
      }),
    ],
    TODAY,
    TZ,
  );
  assert.equal(row?.type, 'dose');
  assert.equal(row?.title, 'Dose · 2 mg');
  assert.equal(row?.time, '9:00 am');
  assert.equal(row?.day, 'today');
  assert.equal(timelineCardContent(row!).metrics.length, 0);
});

test('an unsynced un-tick takes the server row away', () => {
  assert.deepEqual(withLocalDoses([server], [tick({ deleted: true })], TODAY, TZ), []);
});

test('the server row for the same tick is kept, with its vial line', () => {
  const rows = withLocalDoses(
    [server],
    [
      tick({
        amount: 2,
        unit: 'mg',
        takenAt: new Date(server.timeMs).toISOString(),
      }),
    ],
    TODAY,
    TZ,
  );
  assert.deepEqual(rows, [server]);
  assert.deepEqual(timelineCardContent(rows[0]!).metrics, [
    { text: 'Week 6 of this vial · 3 doses left' },
  ]);
});

test('the latest change wins, and a capsule or another domain is never a dose', () => {
  const rows = withLocalDoses(
    [],
    [
      tick({
        amount: 2,
        unit: 'mg',
        takenAt: new Date(at(TODAY, '07:00')).toISOString(),
      }),
      tick({ deleted: true }),
      {
        ...tick({
          amount: 1,
          unit: 'capsules',
          takenAt: new Date(at(TODAY, '07:00')).toISOString(),
        }),
        payload: {
          supplementId: 'sup-2',
          amount: 1,
          unit: 'capsules',
          takenAt: new Date(at(TODAY, '07:00')).toISOString(),
        },
      },
      {
        domain: 'food_logs',
        date: TODAY,
        payload: { supplementId: 'x', amount: 2, unit: 'mg' },
      },
    ],
    TODAY,
    TZ,
  );
  assert.deepEqual(rows, []);
});

test('a change older than yesterday leaves the timeline alone', () => {
  assert.deepEqual(withLocalDoses([server], [tick({ deleted: true }, '2026-09-01')], TODAY, TZ), [
    server,
  ]);
});

// #3863: once the upload is confirmed the op leaves the outbox; the local supplement log keeps the row.
const logged = (o: Record<string, unknown> = {}) => ({
  id: 'sup-1',
  loggedToday: true,
  loggedDose: {
    amount: 2,
    unit: 'mg',
    takenAt: new Date(at(TODAY, '09:00')).toISOString(),
  },
  ...o,
});

test('#3863: a confirmed upload, offline, with no server row yet: the dose row stays', () => {
  const ticked = withLocalDoses(
    [],
    [
      tick({
        amount: 2,
        unit: 'mg',
        takenAt: new Date(at(TODAY, '09:00')).toISOString(),
      }),
    ],
    TODAY,
    TZ,
    [logged()],
  );
  // The op is confirmed and removed; the timeline refetch has not landed (offline).
  const confirmed = withLocalDoses([], [], TODAY, TZ, [logged()]);
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0]?.title, 'Dose · 2 mg');
  assert.equal(confirmed[0]?.time, ticked[0]?.time);
  assert.equal(confirmed[0]?.subtitle, undefined);
});

test('#3863: the server row wins over the local log, and a queued un-tick still removes it', () => {
  assert.deepEqual(withLocalDoses([server], [], TODAY, TZ, [logged()]), [server]);
  assert.deepEqual(withLocalDoses([server], [tick({ deleted: true })], TODAY, TZ, [logged()]), []);
});

test('#3863: an untaken, untimed or non-mg local log adds no row', () => {
  const none = [
    logged({ loggedToday: false }),
    logged({ loggedDose: { amount: 2, unit: 'mg', takenAt: null } }),
    logged({
      loggedDose: {
        amount: 1,
        unit: 'capsules',
        takenAt: new Date(at(TODAY, '09:00')).toISOString(),
      },
    }),
  ];
  for (const s of none) assert.deepEqual(withLocalDoses([], [], TODAY, TZ, [s]), []);
});
