import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { budgetEnergyModel, nutritionEnergyModel, remainingText } from '../src/features/nutrition/data/energy-model.ts';
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors';
import { guardHomeWidgets } from '../src/integrations/widgets/guarded.ts';
import type { HomeWidgets } from '../src/integrations/widgets/types.ts';
import { parseLaunchTarget } from '../src/features/widgets/launch-target.ts';
import { drainPendingWater, parsePendingWater } from '../src/features/widgets/pending-water.ts';
import { palettes } from '../src/shared/theme/palettes.ts';
import { domainTones, macroColorsLight, progressColors, statusColors } from '../src/shared/theme/tokens.ts';
import { HealthStore } from '../src/features/health/data/HealthStore.ts';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const module = '../modules/home-widgets/android/src/main/';

// --- kcal left: Home's card, not the Nutrition screen's ---------------------------------------

test('kcal left is Home\'s nutrition card: the budget alone, with no fall back to the calorie target', () => {
  const totals = { calories: 1260, proteinG: 98, carbsG: 132, fatG: 46 };
  const home = budgetEnergyModel({ totals, recordedIntake: null, budgetKcal: null });
  const screen = nutritionEnergyModel({ totals, recordedIntake: null, budgetKcal: null, targetCalories: 2300, targets: {}, scaledTargets: null });
  assert.equal(home.remaining, null);
  assert.equal(screen.remaining, 1040);
  assert.deepEqual(remainingText(1040), { value: '1,040', label: 'kcal left' });
});

test('WidgetSync takes kcal from budgetEnergyModel and the macro targets from the Nutrition screen\'s model', async () => {
  const source = await read('../src/features/widgets/WidgetSync.tsx');
  assert.match(source, /budgetEnergyModel\(\{[^}]*budgetKcal: energyData\?\.balance\?\.budgetKcal/s);
  assert.match(source, /nutritionEnergyModel\(\{/);
  assert.match(source, /\n\s+budget,\n/);
  const snapshot = await read('../src/features/widgets/snapshot.ts');
  assert.match(snapshot, /kcal: budget\?\.remaining == null/);
});

// --- the guard --------------------------------------------------------------------------------

function fakeNative() {
  const calls: string[] = [];
  const native: HomeWidgets = {
    writeSnapshot: (json) => void calls.push(`write:${json}`),
    clearSnapshot: () => void calls.push('clear'),
    peekPending: () => '[{"id":"x"}]',
    ackPending: (ids) => void calls.push(`ack:${ids.join(',')}`),
    takeLaunchTarget: () => 'home',
  };
  return { native, calls };
}

test('after sign-out nothing is written and no queued tap is read until an account resumes the guard', () => {
  const { native, calls } = fakeNative();
  const guarded = guardHomeWidgets(native);
  guarded.writeSnapshot('one');
  guarded.clearSnapshot();
  guarded.writeSnapshot('late debounce');
  assert.equal(guarded.peekPending(), '[]');
  guarded.resume();
  guarded.writeSnapshot('two');
  assert.equal(guarded.peekPending(), '[{"id":"x"}]');
  assert.deepEqual(calls, ['write:one', 'clear', 'write:two']);
});

test('WidgetSync resumes the widget guard when an account\'s sync mounts', async () => {
  const source = await read('../src/features/widgets/WidgetSync.tsx');
  // The effect has no dependencies: it runs once per mount, and a new account remounts via its key.
  assert.match(source, /useEffect\(\(\) => homeWidgets\?\.resume\(\), \[\]\);/);
  // Signed out renders nothing, so the guard stays closed until a signed-in sync mounts.
  assert.match(source, /return userId \? <AccountWidgetSync key=\{userId\} userId=\{userId\} \/> : null;/);
  const resume = source.indexOf('homeWidgets?.resume()');
  const firstWrite = source.indexOf('homeWidgets.writeSnapshot');
  assert.ok(resume > 0 && resume < firstWrite);
});

// --- water taps from the home screen ----------------------------------------------------------

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';
const tap = (id: string, over: Record<string, unknown> = {}) => ({ id, ml: 250, at: 1_760_000_000_000, date: '2026-10-23', user: 'user-one', ...over });
function queue(initial: unknown[]) {
  let taps = [...initial] as { id: string }[];
  const acked: string[][] = [];
  return {
    widgets: {
      peekPending: () => JSON.stringify(taps),
      ackPending: (ids: string[]) => {
        acked.push(ids);
        taps = taps.filter((entry) => !ids.includes(entry.id));
      },
    },
    left: () => taps.map((entry) => entry.id),
    acked,
  };
}

test('every queued tap is recorded once, with its own id and the day it was made, then acknowledged', async () => {
  const q = queue([tap(ID_A), tap(ID_B, { date: '2026-10-22' })]);
  const recorded: [number, string, string][] = [];
  const count = await drainPendingWater(q.widgets, 'user-one', async (ml, date, id) => void recorded.push([ml, date, id]));
  assert.equal(count, 2);
  assert.deepEqual(recorded, [[250, '2026-10-23', ID_A], [250, '2026-10-22', ID_B]]);
  assert.deepEqual(q.acked, [[ID_A, ID_B]]);
  assert.deepEqual(q.left(), []);
  // Draining again finds nothing: acknowledged taps are never recorded twice.
  assert.equal(await drainPendingWater(q.widgets, 'user-one', async () => assert.fail('recorded again')), 0);
});

test('a tap whose record failed stays queued with those after it, and nothing is acknowledged for it', async () => {
  const q = queue([tap(ID_A), tap(ID_B), tap(ID_C)]);
  let calls = 0;
  const count = await drainPendingWater(q.widgets, 'user-one', async () => {
    if (++calls === 2) throw new Error('Check your account before logging health records.');
  });
  assert.equal(count, 1);
  assert.deepEqual(q.acked, [[ID_A]]);
  assert.deepEqual(q.left(), [ID_B, ID_C]);
});

test('another account\'s taps, invalid amounts and unreadable entries are dropped, not recorded', async () => {
  const q = queue([tap(ID_A, { user: 'someone-else' }), tap(ID_B, { ml: 5001 }), tap(ID_C, { ml: 0 }), { id: 'not-a-tap' }, tap('44444444-4444-4444-8444-444444444444')]);
  const recorded: string[] = [];
  const count = await drainPendingWater(q.widgets, 'user-one', async (_ml, _date, id) => void recorded.push(id));
  assert.equal(count, 1);
  assert.deepEqual(recorded, ['44444444-4444-4444-8444-444444444444']);
  assert.deepEqual(q.left(), []);
});

test('an unreadable queue is an empty one', () => {
  for (const raw of ['', 'nope', '{}', 'null']) assert.deepEqual(parsePendingWater(raw), []);
});

test('the store keeps a widget tap\'s id, so a tap read again after a crash is not added twice', async () => {
  const saved = new Map<string, string>();
  const store = new HealthStore(
    { get: async (key: string) => saved.get(key) ?? null, set: async (key: string, value: string) => void saved.set(key, value), remove: async (key: string) => void saved.delete(key) } as never,
    { origin: 'https://example.com', userId: 'user-one', timezone: 'Australia/Sydney', get: async () => { throw new Error('offline'); }, post: async () => { throw new Error('offline'); } } as never,
    () => 'fresh-id-that-is-never-used-for-a-tap',
  );
  await store.initialize();
  await store.addWater(250, '2026-10-23', ID_A);
  await store.addWater(250, '2026-10-23', ID_A);
  const operations = store.getSnapshot().operations;
  assert.deepEqual(operations.map((operation) => [operation.id, operation.payload]), [[ID_A, { waterMlDelta: 250 }]]);
});

// --- where a tap goes ------------------------------------------------------------------------

test('launch targets: the screens a widget can ask for, and nothing else', () => {
  assert.deepEqual(parseLaunchTarget('home'), { kind: 'home' });
  assert.deepEqual(parseLaunchTarget('workout'), { kind: 'workout' });
  assert.deepEqual(parseLaunchTarget('nutrition'), { kind: 'nutrition' });
  assert.deepEqual(parseLaunchTarget('train-instead'), { kind: 'train-instead' });
  assert.deepEqual(parseLaunchTarget('next-session:12'), { kind: 'session', id: '12' });
  assert.deepEqual(parseLaunchTarget('next-session:a:b'), { kind: 'session', id: 'a:b' });
  for (const bad of [null, undefined, '', 'next-session:', 'settings', 'com.trainingai.app.preview://auth?code=1', 'HOME']) {
    assert.equal(parseLaunchTarget(bad), null, String(bad));
  }
});

test('a widget launch never reaches the sign-in handler: it travels as an extra, not a link', async () => {
  const launch = await read('../src/features/widgets/useWidgetLaunch.ts');
  assert.doesNotMatch(launch, /Linking|openURL|getInitialURL|session\.ts|handleUrl|callback/i);
  const render = (await read(`${module}java/expo/modules/homewidgets/WidgetRender.kt`)).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  assert.doesNotMatch(render, /setData|Uri\.parse|scheme/i);
  assert.match(render, /putExtra\(LaunchInbox\.EXTRA, target\)/);
  const app = await read('../src/app/App.tsx');
  assert.match(app, /useWidgetLaunch\(!!dataReader,/);
  // While signed out the target is taken and dropped, never acted on.
  assert.match(launch, /if \(target && latest\.current\.enabled\)/);
});

// --- the native side: things the Kotlin compile cannot see ------------------------------------

test('every resource and id the Kotlin names exists, so a typo fails here and not only in the Android build', async () => {
  const dir = new URL(`${module}java/expo/modules/homewidgets/`, import.meta.url);
  const kotlin = (await Promise.all((await readdir(dir)).map((name) => readFile(new URL(name, dir), 'utf8')))).join('\n');
  const res = new URL(`${module}res/`, import.meta.url);
  const layouts = (await Promise.all((await readdir(new URL('layout/', res))).map((name) => readFile(new URL(`layout/${name}`, res), 'utf8')))).join('\n');
  const ids = new Set([...layouts.matchAll(/@\+id\/(\w+)/g)].map((match) => match[1]));
  const strings = await read(`${module}res/values/strings.xml`);
  const colors = await read(`${module}res/values/colors.xml`);
  const names = (xml: string, tag: string) => new Set([...xml.matchAll(new RegExp(`<${tag} name="(\\w+)"`, 'g'))].map((match) => match[1]));
  const layoutFiles = new Set((await readdir(new URL('layout/', res))).map((name) => name.replace('.xml', '')));
  for (const [, id] of kotlin.matchAll(/R\.id\.(\w+)/g)) assert.ok(ids.has(id!), `R.id.${id}`);
  for (const [, name] of kotlin.matchAll(/R\.string\.(\w+)/g)) assert.ok(names(strings, 'string').has(name!), `R.string.${name}`);
  for (const [, name] of kotlin.matchAll(/R\.color\.(\w+)/g)) assert.ok(names(colors, 'color').has(name!), `R.color.${name}`);
  for (const [, name] of kotlin.matchAll(/R\.layout\.(\w+)/g)) assert.ok(layoutFiles.has(name!), `R.layout.${name}`);
  // Resources the XML names: strings, colours and drawables.
  const xmlFiles = [layouts, ...(await Promise.all(['xml/home_widget_today_info.xml', 'xml/home_widget_next_info.xml', 'xml/home_widget_nutrition_info.xml', 'drawable/home_widget_background.xml'].map((file) => read(`${module}res/${file}`))))].join('\n');
  const drawables = new Set((await readdir(new URL('drawable/', res))).map((name) => name.replace('.xml', '')));
  for (const [, name] of xmlFiles.matchAll(/@string\/(\w+)/g)) assert.ok(names(strings, 'string').has(name!), `@string/${name}`);
  for (const [, name] of xmlFiles.matchAll(/@color\/(\w+)/g)) assert.ok(names(colors, 'color').has(name!), `@color/${name}`);
  for (const [, name] of xmlFiles.matchAll(/@drawable\/(\w+)/g)) assert.ok(drawables.has(name!), `@drawable/${name}`);
  for (const [, name] of xmlFiles.matchAll(/@layout\/(\w+)/g)) assert.ok(layoutFiles.has(name!), `@layout/${name}`);
});

test('the manifest registers each widget and keeps every receiver private', async () => {
  const manifest = await read(`${module}AndroidManifest.xml`);
  for (const provider of ['TodayWidgetProvider', 'NextWorkoutWidgetProvider', 'NutritionWidgetProvider', 'WaterTapReceiver', 'WidgetRefreshReceiver']) {
    assert.match(manifest, new RegExp(`android:name="expo\\.modules\\.homewidgets\\.${provider}"\\s+android:exported="false"`));
  }
  assert.doesNotMatch(manifest, /exported="true"|SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM|RECEIVE_BOOT_COMPLETED/);
  for (const name of ['today', 'next', 'nutrition']) {
    const info = await read(`${module}res/xml/home_widget_${name}_info.xml`);
    assert.match(info, /android:updatePeriodMillis="0"/, 'a timer would only redraw the same snapshot and wake the phone');
    assert.match(info, /android:widgetCategory="home_screen"/);
  }
  const alarms = await read(`${module}java/expo/modules/homewidgets/WidgetRefresh.kt`);
  assert.match(alarms, /alarms\.set\(/);
  assert.doesNotMatch(alarms, /setExact|setAlarmClock|setAndAllowWhileIdle/);
});

test('the widgets\' colours are the app\'s: values and values-night mirror the theme tokens', async () => {
  const parse = (xml: string) => Object.fromEntries([...xml.matchAll(/<color name="home_widget_(\w+)">(#\w+)<\/color>/g)].map((match) => [match[1], match[2]]));
  const light = parse(await read(`${module}res/values/colors.xml`));
  const dark = parse(await read(`${module}res/values-night/colors.xml`));
  const green = palettes.green;
  assert.deepEqual(
    { surface: light.surface, raised: light.raised, brand: light.brand, onbrand: light.onbrand },
    { surface: green.light.surface, raised: green.light.raised, brand: green.light.brand, onbrand: green.light.onBrand },
  );
  assert.deepEqual(
    { surface: dark.surface, raised: dark.raised, brand: dark.brand, onbrand: dark.onbrand, track: dark.track },
    { surface: green.dark.surface, raised: green.dark.raised, brand: green.dark.brand, onbrand: green.dark.onBrand, track: green.dark.brandSurface },
  );
  assert.deepEqual([light.protein, light.carbs, light.fat], [macroColorsLight.protein, macroColorsLight.carbs, macroColorsLight.fat]);
  assert.deepEqual([dark.protein, dark.carbs, dark.fat], [MACRO_COLORS.protein, MACRO_COLORS.carbs, MACRO_COLORS.fat]);
  assert.deepEqual([light.water, dark.water], [progressColors.light.goals.Water, progressColors.dark.goals.Water]);
  assert.deepEqual([light.good, dark.good], [statusColors.light.success, statusColors.dark.success]);
  assert.deepEqual([light.drained, dark.drained], [statusColors.light.danger, statusColors.dark.danger]);
  assert.deepEqual([light.low, dark.low], [domainTones.light.checkin.foreground, domainTones.dark.checkin.foreground]);
});

test('the rest-day card offers "Train instead", which Home answers with its own override', async () => {
  const provider = await read(module + 'java/expo/modules/homewidgets/NextWorkoutWidgetProvider.kt');
  assert.match(provider, /if \(next\.restDay\) R\.string\.home_widget_train_instead else R\.string\.home_widget_sessions/);
  assert.match(provider, /if \(next\.restDay\) "train-instead" else "workout"/);
  assert.match(await read(module + 'res/values/strings.xml'), />Train instead</);
  const app = await read('../src/app/App.tsx');
  assert.match(app, /target\.kind === 'train-instead'[\s\S]*?chooseRestDay\(today, false\)/);
});
