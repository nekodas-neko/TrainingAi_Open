import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SpeechError,
  captureSet,
  voiceSetValues,
  type SpeechEngine,
} from '../src/features/workouts/voice/voice.ts';

function engine(overrides: Partial<SpeechEngine> = {}) {
  const calls: string[] = [];
  const fake: SpeechEngine = {
    available: () => true,
    requestPermission: async () => {
      calls.push('permission');
      return true;
    },
    listen: async () => {
      calls.push('listen');
      return '80 kilos for 8';
    },
    stop: () => {},
    ...overrides,
  };
  return { fake, calls };
}

test('a spoken set comes back as weight and reps, asked for only when used', async () => {
  const { fake, calls } = engine();
  assert.deepEqual(calls, []);
  assert.deepEqual(await captureSet(fake), { kind: 'set', weight: 80, reps: 8 });
  assert.deepEqual(calls, ['permission', 'listen']);
});

test('a heard set is clamped to what the logger accepts', async () => {
  const { fake } = engine({ listen: async () => '9999 kg 0 reps' });
  assert.deepEqual(await captureSet(fake), { kind: 'set', weight: 500, reps: 1 });
});

test('the wheels take the heard weight on their step, in the wheel unit, stored as kg', () => {
  assert.deepEqual(voiceSetValues({ weight: 82, reps: 8 }, 2.5, 'kg'), {
    weight: '82.5',
    reps: '8',
  });
  assert.equal(Number(voiceSetValues({ weight: 135 }, 2.5, 'lb').weight).toFixed(2), '61.23');
  assert.deepEqual(voiceSetValues({ reps: 5 }, 2.5, 'kg'), { reps: '5' });
});

test('a denied microphone says so and never listens', async () => {
  const { fake, calls } = engine({ requestPermission: async () => false });
  assert.deepEqual(await captureSet(fake), {
    kind: 'message',
    message: 'Microphone permission denied',
  });
  assert.ok(!calls.includes('listen'));
});

test('a denial reported while listening reads the same', async () => {
  const { fake } = engine({
    listen: async () => {
      throw new SpeechError('not-allowed');
    },
  });
  assert.deepEqual(await captureSet(fake), {
    kind: 'message',
    message: 'Microphone permission denied',
  });
});

test('unavailable speech says so without asking for the microphone', async () => {
  const { fake, calls } = engine({ available: () => false });
  assert.deepEqual(await captureSet(fake), {
    kind: 'message',
    message: 'Speech recognition unavailable on this device',
  });
  assert.deepEqual(calls, []);
});

test('a recogniser failure is a message, never a throw', async () => {
  const { fake } = engine({
    listen: async () => {
      throw new SpeechError('network');
    },
  });
  assert.deepEqual(await captureSet(fake), { kind: 'message', message: 'Voice logging failed' });
});

test('silence and unreadable phrases fill nothing and say what to say', async () => {
  assert.deepEqual(await captureSet(engine({ listen: async () => null }).fake), {
    kind: 'message',
    message: 'Did not catch that',
  });
  assert.deepEqual(await captureSet(engine({ listen: async () => 'next set' }).fake), {
    kind: 'message',
    message: 'Didn\'t understand "next set" — try "60 kg 6 reps"',
  });
});
