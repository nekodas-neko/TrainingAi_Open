import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCatalog } from '../src/features/workouts/catalog.ts';
import { homeScoreChips } from '../src/features/home/data/score-chips.ts';
import { homeRecommendationModel, type RecommendationInput } from '../src/features/home/data/recommendation-model.ts';
import { nutritionEnergyModel, remainingText } from '../src/features/nutrition/data/energy-model.ts';
import { batterySummary } from '../src/features/health/data/battery-summary.ts';
import { hasContent, snapshotIdentity, widgetSnapshot, type SnapshotInput } from '../src/features/widgets/snapshot.ts';
import { workoutFixture } from './workout-fixture.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import { batterySpec, energySpec, goalsSpec, readinessSpec } from '../src/features/health/data/models.ts';
import { trainingDaySpecs } from '../src/features/home/data/training-days.ts';
import { recordedIntakeOf } from '../src/features/nutrition/data/recorded-intake.ts';

const today = '2026-10-23';
const now = new Date('2026-10-23T07:42:00+11:00');
const tz = 'Australia/Sydney';
const f = workoutFixture();
const catalog = buildCatalog(f.meta, f.next, f.all, f.reader, 123);
const mood = { soreMuscles: [], energyLevel: 'good' };
const recInput = (over: Partial<RecommendationInput> = {}): RecommendationInput => ({
  catalog,
  catalogLoading: false,
  trained: [],
  active: undefined,
  restChoice: undefined,
  mood,
  moodFailed: false,
  today,
  ...over,
});
const energy = nutritionEnergyModel({
  totals: { calories: 1260, proteinG: 98, carbsG: 132, fatG: 46 },
  recordedIntake: null,
  budgetKcal: 2500,
  targetCalories: 2300,
  targets: { proteinG: 160, carbsG: 250, fatG: 70 },
  scaledTargets: null,
});
const input = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  date: today,
  now,
  timezone: tz,
  scores: homeScoreChips({ readinessDisplayScore: 78.4, sleepScore: 84, activityScore: 61, restingHrLastNight: 52 }, [], today),
  battery: { hasData: true, current: 64, label: 'Good', trend: 'charging' },
  recommendation: homeRecommendationModel(recInput()),
  energy,
  water: { ml: 1250, goalMl: 2500 },
  ...over,
});

test("Home's score chips: labels, values and fallbacks", () => {
  const chips = homeScoreChips({ readinessDisplayScore: 78.4, sleepScore: 84, activityScore: 61, restingHrLastNight: 52 }, [], today);
  assert.deepEqual(chips.map((c) => [c.label, c.value]), [['Readiness', 78.4], ['Resting HR', 52], ['Sleep', 84], ['Activity', 61]]);
  const sparse = homeScoreChips({ hrCurrent: 61, limited: true }, [{ date: '2026-10-22', durationHours: 7.2 }], today);
  assert.equal(sparse[0]!.qualified, true);
  assert.equal(sparse[1]!.label, 'Heart Rate');
  assert.deepEqual([sparse[2]!.label, sparse[2]!.display], ['Sleep (h)', '7.2']);
  assert.equal(sparse[3]!.value, null);
});

test("Home's recommendation states, in the card's order of precedence", () => {
  assert.equal(homeRecommendationModel(recInput({ mood: undefined })).kind, 'loading');
  assert.equal(homeRecommendationModel(recInput({ mood: undefined, moodFailed: true })).kind, 'checkin');
  assert.equal(homeRecommendationModel(recInput({ catalog: null, catalogLoading: true })).kind, 'loading');
  assert.equal(homeRecommendationModel(recInput({ mood: null })).kind, 'checkin');
  assert.deepEqual(homeRecommendationModel(recInput({ restChoice: true })), { kind: 'rest', reason: 'Next up: Upper body' });
  assert.equal(homeRecommendationModel(recInput({ catalog: null })).kind, 'none');

  const model = homeRecommendationModel(recInput());
  assert.equal(model.kind, 'session');
  if (model.kind !== 'session') return;
  assert.equal(model.eyebrow, 'Recommended Today');
  assert.equal(model.name, 'Upper body');
  assert.equal(model.action, 'start');
  assert.deepEqual(model.facts.map((fact) => fact.text).slice(-2), ['1 exercises', 'Last: —']);

  const done = homeRecommendationModel(recInput({ trained: ['Upper body'], restChoice: true }));
  assert.equal(done.kind === 'session' && [done.eyebrow, done.action].join(), 'Trained Today,completed');
  const active = homeRecommendationModel(recInput({ active: { id: 'w1', sessionName: 'Upper body (edited)' } }));
  assert.equal(active.kind === 'session' && [active.eyebrow, active.name, active.action, active.activeId].join(), 'Workout in progress,Upper body (edited),resume,w1');
});

test("kcal left follows the energy card: budget over target, recorded intake over the logged total", () => {
  assert.equal(energy.goal, 2500);
  assert.equal(energy.remaining, 1240);
  assert.deepEqual(remainingText(1240), { value: '1,240', label: 'kcal left' });
  assert.deepEqual(remainingText(-80.4), { value: '80', label: 'kcal over' });
  const recorded = nutritionEnergyModel({
    totals: { calories: 1260, proteinG: 0, carbsG: 0, fatG: 0 },
    recordedIntake: 900,
    budgetKcal: null,
    targetCalories: 2300,
    targets: { proteinG: 160 },
    scaledTargets: { proteinG: 170, carbsG: 260, fatG: 75 },
  });
  assert.equal(recorded.remaining, 1400);
  assert.equal(recorded.targets.proteinG, 170);
  const noGoal = nutritionEnergyModel({ totals: null, recordedIntake: null, budgetKcal: null, targetCalories: null, targets: {}, scaledTargets: null });
  assert.equal(noGoal.remaining, null);
});

test("Body Battery's headline matches the card's", () => {
  assert.deepEqual(batterySummary({ hasData: true, current: 64, label: 'Good', trend: 'charging' }), {
    value: '64', levelLabel: 'Good', trend: 'charging', trendLabel: 'Charging',
  });
  assert.deepEqual(batterySummary({ hasData: false, current: null, label: 'Good', trend: 'steady' }), {
    value: undefined, levelLabel: 'No data yet', trend: null, trendLabel: null,
  });
  assert.equal(batterySummary(null).levelLabel, 'Waiting for readings');
});

test('the snapshot is version 1 and carries every value already formatted', () => {
  const snapshot = widgetSnapshot(input());
  assert.equal(snapshot.v, 1);
  assert.equal(snapshot.date, today);
  assert.equal(snapshot.updated, 'Updated 7:42 am');
  assert.deepEqual(snapshot.today.scores.map((s) => [s.label, s.value]), [['Readiness', '78'], ['Resting HR', '52'], ['Sleep', '84'], ['Activity', '61']]);
  assert.deepEqual(snapshot.today.scores[0]!.color, { dark: '#60a5fa', light: '#2563eb' });
  assert.deepEqual(snapshot.today.battery, { value: '64', label: 'Good · Charging', level: 64, band: 'good' });
  const model = homeRecommendationModel(recInput());
  assert.ok(model.kind === 'session');
  assert.deepEqual(snapshot.next, {
    eyebrow: 'Recommended Today', name: 'Upper body', meta: model.facts.map((fact) => fact.text).join(' · '), sessionId: 'session-one', restDay: false,
  });
  assert.deepEqual(snapshot.nutrition?.kcal, { value: '1,240', label: 'kcal left' });
  assert.deepEqual(snapshot.nutrition?.macros.map((m) => m.left), ['62 g left', '118 g left', '24 g left']);
  assert.deepEqual(snapshot.nutrition?.water, { text: '1.3L', goal: 'Goal: 2.5L', fraction: 0.5 });
  assert.equal('collection' in snapshot, false);
  // The widget parses JSON: everything survives the round trip.
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
});

test('missing data stays missing in the snapshot rather than turning into zero', () => {
  const snapshot = widgetSnapshot(
    input({
      scores: homeScoreChips({}, [], today),
      battery: { hasData: false, current: null, label: 'Good', trend: 'steady' },
      energy: nutritionEnergyModel({ totals: null, recordedIntake: null, budgetKcal: null, targetCalories: null, targets: {}, scaledTargets: null }),
      water: { ml: null, goalMl: 2500 },
    }),
  );
  assert.ok(snapshot.today.scores.every((s) => s.value === null));
  assert.equal(snapshot.today.battery, null);
  assert.equal(snapshot.nutrition?.kcal, null);
  assert.ok(snapshot.nutrition?.macros.every((m) => m.left === null && m.fraction === null));
  assert.deepEqual(snapshot.nutrition?.water, { text: '—', goal: 'Goal: 2.5L', fraction: null });
});

test('rest day and check-in cards reach the snapshot without a session to open', () => {
  assert.deepEqual(widgetSnapshot(input({ recommendation: homeRecommendationModel(recInput({ restChoice: true })) })).next, {
    eyebrow: 'Rest Day', name: 'Rest Day', meta: 'Next up: Upper body', sessionId: null, restDay: true,
  });
  assert.equal(widgetSnapshot(input({ recommendation: homeRecommendationModel(recInput({ mood: null })) })).next?.sessionId, null);
  assert.equal(widgetSnapshot(input({ recommendation: { kind: 'loading' } })).next, null);
});

test('only a change of numbers is a new snapshot, and an empty one is never written', () => {
  const a = widgetSnapshot(input());
  const b = widgetSnapshot(input({ now: new Date(now.getTime() + 60_000) }));
  assert.notEqual(a.updated, b.updated);
  assert.equal(snapshotIdentity(a), snapshotIdentity(b));
  assert.notEqual(snapshotIdentity(a), snapshotIdentity(widgetSnapshot(input({ water: { ml: 1500, goalMl: 2500 } }))));
  assert.equal(hasContent(a), true);
  assert.equal(hasContent(widgetSnapshot(input({ scores: null, recommendation: { kind: 'loading' } }))), false);
});

test('the band-style short labels come from the same chip model', () => {
  const chips = homeScoreChips({ restingHr: 50 }, [], today);
  assert.deepEqual(chips.map((c) => c.shortLabel), ['Ready', 'Rest HR', 'Sleep', 'Move']);
  assert.equal(homeScoreChips({}, [], today)[1]!.shortLabel, 'HR');
});

test("the session's facts are #3258's sessionFacts, so the widget says Yesterday as Home does", () => {
  const sessions = catalog.program!.sessions.map((s) => ({ ...s, lastTrained: '2026-10-22' }));
  const model = homeRecommendationModel(recInput({ catalog: { ...catalog, program: { ...catalog.program!, sessions } } }));
  assert.ok(model.kind === 'session');
  assert.equal(model.facts.at(-1)!.text, 'Last: Yesterday');
});

function recordingResources() {
  const calls: string[] = [];
  const disk = new Map<string, string>();
  const resources = new WorkoutResources(
    {
      get: async (key: string) => disk.get(key) ?? null,
      set: async (key: string, value: string) => void disk.set(key, value),
      remove: async (key: string) => void disk.delete(key),
    },
    {
      origin: 'https://example.com',
      userId: 'one',
      timezone: tz,
      get: async (path: string) => {
        calls.push(path);
        return { readinessDisplayScore: 78 };
      },
      post: async () => {
        throw new Error('offline');
      },
    } as never,
    () => 1000,
    () => 'id',
  );
  return { resources, calls };
}

test("WidgetSync's reads request nothing: a resource nobody loaded stays empty, so the last snapshot holds", async () => {
  const { resources, calls } = recordingResources();
  const specs = [readinessSpec(today), batterySpec(today), goalsSpec, energySpec(today), ...Object.values(trainingDaySpecs(today))];
  for (const spec of specs) assert.equal(resources.state(spec as never).data, null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls, []);
  const snapshot = widgetSnapshot(input({ scores: null, battery: null, recommendation: { kind: 'loading' } }));
  assert.equal(hasContent(snapshot), false);

  // Once Home has loaded a resource, the same passive read sees it, still without a request of its own.
  await resources.load(readinessSpec(today));
  const before = calls.length;
  assert.equal(resources.state(readinessSpec(today)).data?.readinessDisplayScore, 78);
  assert.equal(calls.length, before);
});

test('WidgetSync mounts no hook that loads or refreshes', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/features/widgets/WidgetSync.tsx', import.meta.url), 'utf8');
  for (const fetching of ['useWorkoutResource(', 'useRecordedIntake(', 'useHome(', 'useTrainingDays(', '.refresh(', '.load(', 'fetch(']) {
    assert.equal(source.includes(fetching), false, fetching);
  }
  const provider = await readFile(new URL('../src/features/workouts/data/WorkoutDataProvider.tsx', import.meta.url), 'utf8');
  const passive = provider.slice(provider.indexOf('export function usePassiveResource'), provider.indexOf('export function useWorkoutResource<'));
  assert.match(passive, /resources\?\.state\(spec\)/);
  assert.doesNotMatch(passive, /load\(|useEffect/);
});

test('recordedIntakeOf reads the store as it stands: nothing logged is no intake, not zero', () => {
  const empty = { view: { totals: null, logs: [], mealTypes: [], mealStatuses: {} }, operations: [] };
  assert.equal(recordedIntakeOf(empty, today, null).intake, null);
});
