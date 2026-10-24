import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SpeechError,
  applyHeardSet,
  captureSet,
  voiceSetValues,
  type SpeechEngine,
} from '../src/features/workouts/voice/voice.ts';
import { speechEngineFor, type SpeechModule } from '../src/features/workouts/voice/engine.ts';
import { engineIfEnabled } from '../src/features/workouts/voice/useVoiceEngine.ts';

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
    message: 'Didn\'t catch that — try "60 kg 6 reps"',
  });
});

test('the recogniser being refused by the device reads as unavailable', async () => {
  for (const code of ['service-not-allowed', 'language-not-supported']) {
    const { fake } = engine({
      listen: async () => {
        throw new SpeechError(code);
      },
    });
    assert.deepEqual(await captureSet(fake), {
      kind: 'message',
      message: 'Speech recognition unavailable on this device',
    });
  }
});

test('a weight-only or reps-only phrase comes back with just that field', async () => {
  const weight = await captureSet(engine({ listen: async () => '70 kg' }).fake);
  assert.deepEqual(weight, { kind: 'set', weight: 70, reps: undefined });
  const reps = await captureSet(engine({ listen: async () => '12 reps' }).fake);
  assert.deepEqual(reps, { kind: 'set', weight: undefined, reps: 12 });
});

function controller(accept = true) {
  const calls: string[][] = [];
  return {
    calls,
    updateSet: async (...args: string[]) => {
      calls.push(args);
      return accept;
    },
    recordSet: async () => {
      calls.push(['recordSet']);
      return true;
    },
  };
}
const ids = { workoutId: 'w', exerciseId: 'e', setId: 's' };

test('a heard set edits the weight and reps and never records the set', async () => {
  const c = controller();
  assert.equal(await applyHeardSet(c, ids, { weight: 82, reps: 8 }, 2.5, 'kg'), true);
  assert.deepEqual(c.calls, [
    ['w', 'e', 's', 'weight', '82.5'],
    ['w', 'e', 's', 'reps', '8'],
  ]);
});

test('a busy journal reports the values were not applied', async () => {
  assert.equal(await applyHeardSet(controller(false), ids, { reps: 8 }, 2.5, 'kg'), false);
  assert.equal(await applyHeardSet(null, ids, { reps: 8 }, 2.5, 'kg'), false);
});

test('a set already recorded never gets a voice engine', () => {
  let looked = false;
  const create = () => {
    looked = true;
    return engine().fake;
  };
  assert.equal(engineIfEnabled(false, create), null);
  assert.equal(looked, false);
  assert.ok(engineIfEnabled(true, create));
});

test('no engine where speech is missing or throws asking', () => {
  assert.equal(engineIfEnabled(true, () => null), null);
  assert.equal(engineIfEnabled(true, () => engine({ available: () => false }).fake), null);
  assert.equal(
    engineIfEnabled(true, () =>
      engine({
        available: () => {
          throw new Error('native');
        },
      }).fake,
    ),
    null,
  );
});

function fakeModule(options: { startThrows?: boolean } = {}) {
  const listeners: Record<string, ((e: never) => void) | undefined> = {};
  let active = 0;
  let stopped = 0;
  const module = {
    isRecognitionAvailable: () => true,
    requestPermissionsAsync: async () => ({ granted: true }),
    addListener(event: string, listener: (e: never) => void) {
      listeners[event] = listener;
      active += 1;
      return {
        remove() {
          listeners[event] = undefined;
          active -= 1;
        },
      };
    },
    start() {
      if (options.startThrows) throw new Error('busy');
    },
    stop() {
      stopped += 1;
    },
  } as unknown as SpeechModule;
  const emit = (event: string, payload?: unknown) =>
    (listeners[event] as ((e: unknown) => void) | undefined)?.(payload);
  return { module, emit, active: () => active, stopped: () => stopped };
}

test('a missing native module gives no engine', () => {
  assert.equal(speechEngineFor(null), null);
  assert.equal(speechEngineFor(undefined), null);
});

test('the last transcript is returned when recognition ends, and listeners are removed', async () => {
  const native = fakeModule();
  const listening = speechEngineFor(native.module)!.listen();
  native.emit('result', { results: [{ transcript: '60 kg' }] });
  native.emit('result', { results: [{ transcript: '60 kg 6 reps' }] });
  native.emit('end');
  assert.equal(await listening, '60 kg 6 reps');
  assert.equal(native.active(), 0);
});

test('silence, a timeout and an abort resolve to nothing heard', async () => {
  for (const code of ['no-speech', 'speech-timeout', 'aborted']) {
    const native = fakeModule();
    const listening = speechEngineFor(native.module)!.listen();
    native.emit('error', { error: code });
    assert.equal(await listening, null);
    assert.equal(native.active(), 0);
  }
});

test('any other recogniser error rejects with its code and removes the listeners', async () => {
  const native = fakeModule();
  const listening = speechEngineFor(native.module)!.listen();
  native.emit('error', { error: 'not-allowed' });
  await assert.rejects(listening, (error: unknown) => error instanceof SpeechError && error.code === 'not-allowed');
  assert.equal(native.active(), 0);
});

test('start() throwing removes the listeners and rejects', async () => {
  const native = fakeModule({ startThrows: true });
  await assert.rejects(speechEngineFor(native.module)!.listen(), /busy/);
  assert.equal(native.active(), 0);
});

test('stop() reaches the native module', () => {
  const native = fakeModule();
  speechEngineFor(native.module)!.stop();
  assert.equal(native.stopped(), 1);
});
