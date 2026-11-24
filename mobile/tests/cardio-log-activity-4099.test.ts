import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openAfterClose, type Timers } from '../src/features/activities/data/open-after-close.ts';
import { pickActivity, type PickDeps } from '../src/features/activities/data/pick-activity.ts';

// #4099: choosing a tile in Log Activity closed the sheet and opened the activity in the same
// commit, which left the sheet's Modal up over the next screen. The order, the single start and the
// open-session case are held here; the Modal itself is in sheet-hidden-screen-4099.test.ts.

const clock = () => {
  let next = 0;
  const jobs = new Map<number, { at: number; run: () => void }>();
  let now = 0;
  const timers: Timers = {
    set: (run, ms) => {
      jobs.set(++next, { at: now + ms, run });
      return next;
    },
    clear: (handle) => void jobs.delete(handle as number),
  };
  return {
    timers,
    advance(ms: number) {
      now += ms;
      for (const [id, job] of [...jobs]) if (job.at <= now) (jobs.delete(id), job.run());
    },
  };
};

test('the navigation runs once when the sheet reports it closed, and not again from the timer', () => {
  const t = clock();
  let opened = 0;
  const after = openAfterClose(() => opened++, 700, t.timers);
  assert.equal(opened, 0);
  after.closed();
  after.closed();
  t.advance(2000);
  assert.equal(opened, 1);
});

test('a close that never reports still opens the activity, once', () => {
  const t = clock();
  let opened = 0;
  const after = openAfterClose(() => opened++, 700, t.timers);
  t.advance(699);
  assert.equal(opened, 0);
  t.advance(1);
  after.closed();
  t.advance(5000);
  assert.equal(opened, 1);
});

test('the navigation does not run from a hidden screen, and the lock is still released', () => {
  const t = clock();
  let opened = 0,
    settled = 0;
  const after = openAfterClose(() => opened++, 700, t.timers, () => settled++, () => false);
  after.closed();
  t.advance(5000);
  assert.equal(opened, 0);
  assert.equal(settled, 1);
});

test('a cancelled navigation never runs', () => {
  const t = clock();
  let opened = 0;
  const after = openAfterClose(() => opened++, 700, t.timers);
  after.cancel();
  after.closed();
  t.advance(5000);
  assert.equal(opened, 0);
});

const type = { id: 'treadmill', label: 'Treadmill', icon: 'PersonSimpleWalk', isDistanceBased: false };
function setup(over: Partial<PickDeps> = {}) {
  const log: string[] = [];
  let release: () => void = () => {};
  const started: string[] = [];
  const deps: PickDeps = {
    store: {
      start: (t) => {
        started.push(t.id);
        return new Promise<void>((resolve) => (release = resolve));
      },
    },
    hasSession: false,
    closeSheet: () => log.push('close'),
    afterSheet: () => void log.push('armed'),
    inProgress: () => void log.push('in-progress'),
    openActivity: () => log.push('open'),
    setBusy: (busy) => log.push(`busy:${busy}`),
    setError: (message) => log.push(`error:${message}`),
    ...over,
  };
  return { deps, log, started, release: () => release() };
}

test('choosing a tile starts one session, arms the navigation, then closes the sheet — never opens directly', async () => {
  const guard = { current: false };
  const s = setup();
  const chosen = pickActivity(guard, s.deps, type);
  s.release();
  await chosen;
  assert.deepEqual(s.started, ['treadmill']);
  // `busy` stays true: the tiles are locked until the sheet has closed and the navigation has run.
  assert.deepEqual(s.log, ['busy:true', 'error:null', 'armed', 'close']);
  assert.equal(guard.current, true, 'a second tile is still ignored while the sheet closes');
  assert.ok(!s.log.includes('open'), 'the screen opens from the sheet\'s close, not from here');
});

test('the navigation handed to afterSheet is the screen\'s openActivity', async () => {
  const guard = { current: false };
  let handed: (() => void) | undefined;
  const s = setup({ afterSheet: (next) => void (handed = next) });
  const chosen = pickActivity(guard, s.deps, type);
  s.release();
  await chosen;
  handed?.();
  assert.deepEqual(s.log.filter((entry) => entry === 'open'), ['open']);
});

test('a second tap while the first is starting is ignored: one session', async () => {
  const guard = { current: false };
  const s = setup();
  const first = pickActivity(guard, s.deps, type);
  const second = pickActivity(guard, s.deps, { ...type, id: 'run' });
  await second;
  s.release();
  await first;
  assert.deepEqual(s.started, ['treadmill']);
  assert.equal(s.log.filter((entry) => entry === 'close').length, 1);
});

test('with a session already open, nothing is started and the in-progress notice is shown', async () => {
  const guard = { current: false };
  const s = setup({ hasSession: true });
  await pickActivity(guard, s.deps, type);
  assert.deepEqual(s.started, []);
  assert.deepEqual(s.log, ['busy:true', 'error:null', 'busy:false', 'in-progress']);
  assert.equal(guard.current, false);
});

test('the tiles unlock when the navigation runs, or when it is dropped', async () => {
  for (const how of ['runs', 'dropped'] as const) {
    const guard = { current: false };
    const t = clock();
    let opened = 0;
    const s = setup({
      afterSheet: (next, settled) => {
        const after = openAfterClose(next, 700, t.timers, settled);
        if (how === 'dropped') after.cancel();
        else after.closed();
      },
      openActivity: () => opened++,
    });
    const chosen = pickActivity(guard, s.deps, type);
    s.release();
    await chosen;
    assert.equal(guard.current, false, how);
    assert.equal(opened, how === 'runs' ? 1 : 0, how);
    assert.ok(s.log.includes('busy:false'));
  }
});

test('a second tap in the closing window starts nothing', async () => {
  const guard = { current: false };
  const t = clock();
  const s = setup({ afterSheet: (next, settled) => void openAfterClose(next, 700, t.timers, settled) });
  const first = pickActivity(guard, s.deps, type);
  s.release();
  await first;
  await pickActivity(guard, s.deps, { ...type, id: 'run' });
  assert.deepEqual(s.started, ['treadmill']);
  t.advance(700);
  assert.equal(guard.current, false);
});

test('a start that fails shows the message, keeps the sheet open and releases the tiles', async () => {
  const guard = { current: false };
  const s = setup({
    store: { start: () => Promise.reject(new Error('Resume or discard your current activity first.')) },
  });
  await pickActivity(guard, s.deps, type);
  assert.deepEqual(s.log, [
    'busy:true',
    'error:null',
    'error:Resume or discard your current activity first.',
    'busy:false',
  ]);
  assert.equal(guard.current, false);
});

test('signed out: no store, nothing happens', async () => {
  const guard = { current: false };
  const s = setup({ store: null });
  await pickActivity(guard, s.deps, type);
  assert.deepEqual(s.log, []);
});
