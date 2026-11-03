import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEALTH_ALERTS_FIRED_KEY,
  runHealthAlerts,
  type HealthAlertsRun,
} from '../src/features/health/data/health-alerts.ts';
import { platformSchema } from '../src/features/platform/data/models.ts';
import { readinessSpec } from '../src/features/health/data/models.ts';

const feverNight = { illnessFlag: 'fever', illnessAdvisory: null, label: 'Moderate', hasSufficientData: true };
const calmBattery = { stress: { current: 0, highMinutes: 0 } };
const stressedBattery = { stress: { current: -1, highMinutes: 200 } };

function fixture(over: Partial<HealthAlertsRun> = {}) {
  const store = new Map<string, string>();
  const posted: { type: string; title: string; body: string }[] = [];
  const run = (more: Partial<HealthAlertsRun> = {}) =>
    runHealthAlerts({
      storage: {
        get: async (key) => store.get(key) ?? null,
        set: async (key, value) => void store.set(key, value),
      },
      enabled: true,
      permission: true,
      today: '2026-11-02',
      sources: { readiness: feverNight, battery: calmBattery },
      post: async (type, title, body) => {
        posted.push({ type, title, body });
        return true;
      },
      ...over,
      ...more,
    });
  return { store, posted, run };
}

test('the alerts are on by default in Preview, as in the current app', () => {
  assert.equal(platformSchema.parse({ scope: 'a' }).healthAlerts, true);
});

test('the readiness view keeps the label and data flag the alerts read', () => {
  const parsed = readinessSpec('2026-11-02').schema.parse({ label: 'Low', hasSufficientData: true });
  assert.equal(parsed.label, 'Low');
  assert.equal(parsed.hasSufficientData, true);
});

test('an illness night posts one notification, and readiness-low yields to it', async () => {
  const { posted, run } = fixture();
  const result = await run({ sources: { readiness: { ...feverNight, label: 'Low' }, battery: calmBattery } });
  assert.deepEqual(result, { status: 'checked', fired: ['illness'] });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].title, 'Possible fever');
});

test('a later open the same day does not let low readiness through after the fever alert (#3536)', async () => {
  const { posted, run } = fixture();
  const lowAndFever = { readiness: { ...feverNight, label: 'Low' }, battery: calmBattery };
  assert.deepEqual(await run({ sources: lowAndFever }), { status: 'checked', fired: ['illness'] });
  assert.deepEqual(await run({ sources: lowAndFever }), { status: 'checked', fired: [] });
  assert.deepEqual(posted.map((row) => row.type), ['illness']);
});

test('each type fires: stress, and standalone low readiness', async () => {
  const stress = fixture();
  assert.deepEqual(
    await stress.run({ sources: { readiness: null, battery: stressedBattery } }),
    { status: 'checked', fired: ['stress'] },
  );
  const low = fixture();
  assert.deepEqual(
    await low.run({
      sources: { readiness: { label: 'Low', hasSufficientData: true }, battery: calmBattery },
    }),
    { status: 'checked', fired: ['readiness'] },
  );
});

test('a calm day posts nothing', async () => {
  const { posted, run } = fixture();
  const result = await run({
    sources: { readiness: { illnessFlag: 'normal', label: 'High', hasSufficientData: true }, battery: calmBattery },
  });
  assert.deepEqual(result, { status: 'checked', fired: [] });
  assert.equal(posted.length, 0);
});

test('opening and resuming again the same day does not repeat it; the next day does', async () => {
  const { posted, run } = fixture();
  await run();
  assert.deepEqual(await run(), { status: 'checked', fired: [] });
  assert.equal(posted.length, 1);
  assert.deepEqual(await run({ today: '2026-11-03' }), { status: 'checked', fired: ['illness'] });
  assert.equal(posted.length, 2);
});

test('a second type that appears later the same day still fires once', async () => {
  const { posted, run } = fixture();
  await run({ sources: { readiness: null, battery: calmBattery } });
  await run({ sources: { readiness: feverNight, battery: calmBattery } });
  await run({ sources: { readiness: feverNight, battery: stressedBattery } });
  await run({ sources: { readiness: feverNight, battery: stressedBattery } });
  assert.deepEqual(posted.map((row) => row.type), ['illness', 'stress']);
});

test('two runs started together post it once', async () => {
  const { posted, run } = fixture();
  await Promise.all([run(), run()]);
  assert.equal(posted.length, 1);
});

test('off, no permission and no data post nothing and record nothing', async () => {
  const { posted, store, run } = fixture();
  assert.deepEqual(await run({ enabled: false }), { status: 'off' });
  assert.deepEqual(await run({ permission: false }), { status: 'no-permission' });
  assert.deepEqual(await run({ sources: { readiness: null, battery: null } }), { status: 'no-data' });
  assert.equal(posted.length, 0);
  assert.equal(store.size, 0);
});

test('a notification that was not shown is not counted, so it can fire once allowed', async () => {
  const { posted, store, run } = fixture();
  assert.deepEqual(await run({ post: async () => false }), { status: 'checked', fired: [] });
  assert.equal(store.size, 0);
  assert.deepEqual(await run(), { status: 'checked', fired: ['illness'] });
  assert.equal(posted.length, 1);
});

test('a failed post leaves the type unrecorded and does not block the next run', async () => {
  const { store, run } = fixture();
  await assert.rejects(
    run({
      post: async () => {
        throw new Error('boom');
      },
    }),
    /boom/,
  );
  assert.equal(store.size, 0);
  assert.deepEqual(await run(), { status: 'checked', fired: ['illness'] });
});

test('a damaged saved record reads as nothing fired', async () => {
  const { store, run } = fixture();
  store.set(HEALTH_ALERTS_FIRED_KEY, '{not json');
  assert.deepEqual(await run(), { status: 'checked', fired: ['illness'] });
});

test('a health alert carries the owner, scope and target a tap needs to open the readiness view (#3541)', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const { ALERT_OWNER, HEALTH_ALERT_TARGET } = await import('../src/features/platform/data/models.ts');
  assert.equal(HEALTH_ALERT_TARGET, 'health-readiness');
  // observeAlerts drops a notification that is not the app's own, and AlertNavigation drops one for
  // another scope, so the posted data needs all three.
  assert.match(read('integrations/notifications/platform.native.ts'), /owner: ALERT_OWNER, scope, target: HEALTH_ALERT_TARGET/);
  assert.match(read('features/health/HealthAlerts.tsx'), /healthAlert\(type, title, body, scope\)/);
  assert.match(read('features/platform/components/AlertNavigation.tsx'), /HEALTH_ALERT_TARGET\) onHealthDetail\('readiness'\)/);
  assert.match(read('app/App.tsx'), /onHealthDetail=\{[\s\S]*selectTab\('Health'\);[\s\S]*setHealthDetail\(next\)/);
  assert.equal(typeof ALERT_OWNER, 'string');
});
