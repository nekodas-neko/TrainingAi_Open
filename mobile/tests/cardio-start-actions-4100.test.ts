import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startActions, type StartDeps } from '../src/features/activities/data/cardio-start-actions.ts';
import type { ActivityType } from '../src/features/activities/data/models.ts';

// #4100 D2: the handlers the screen uses, with the in-progress rule driven through them. The old
// test only called `startOutcome` itself, so a handler that skipped the check still passed.
function harness(hasSession: boolean) {
  const calls: string[] = [];
  const deps: StartDeps = {
    hasSession,
    select: (type: ActivityType) => void calls.push(`select:${type.id}`),
    recordTreadmill: (minutes, kind) => void calls.push(`record:${kind}:${minutes}`),
    openWalk: () => void calls.push('openWalk'),
    showInProgress: () => void calls.push('inProgress'),
    afterSheet: (next) => {
      calls.push('afterSheet');
      next();
    },
  };
  return { calls, deps };
}
const sample = (actions: ReturnType<typeof startActions>) => ({
  kind: () => actions.kind('run'),
  kindWalk: () => actions.kind('walk'),
  guided: () => actions.kind('guided'),
  treadmillNow: () => actions.treadmillNow('walk'),
  treadmillLog: () => actions.treadmillLog('run', 30),
  type: () => actions.type({ id: 'cycle', label: 'Cycle', icon: 'x', isDistanceBased: true }),
});

test('every handler the actions expose answers "in progress" and starts nothing', () => {
  const { calls, deps } = harness(true);
  const actions = startActions(deps, () => calls.push('closeSheet'));
  const every = sample(actions);
  // A handler added to `startActions` without a case here fails this count.
  assert.equal(Object.keys(actions).length, 4);
  for (const [name, press] of Object.entries(every)) {
    calls.length = 0;
    press();
    assert.deepEqual(calls, ['afterSheet', 'inProgress', 'closeSheet'], name);
  }
});

test('without an activity open each handler starts what it names', () => {
  const { calls, deps } = harness(false);
  const every = sample(startActions(deps, () => calls.push('closeSheet')));
  const ran: Record<string, string[]> = {};
  for (const [name, press] of Object.entries(every)) {
    calls.length = 0;
    press();
    ran[name] = [...calls];
  }
  assert.deepEqual(ran.kind, ['select:run']);
  assert.deepEqual(ran.kindWalk, ['select:walk']);
  assert.deepEqual(ran.guided, ['afterSheet', 'openWalk', 'closeSheet']);
  assert.deepEqual(ran.treadmillNow, ['select:treadmill']);
  assert.deepEqual(ran.treadmillLog, ['record:run:30']);
  assert.deepEqual(ran.type, ['select:cycle']);
});
