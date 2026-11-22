import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';
import { sizes, spacing, typography } from '../src/shared/theme/tokens.ts';
import { BACK_LABEL, headerMetrics } from '../src/shared/ui/headerMetrics.ts';

// #3760. One page header, in two modes. The owner picked A A A on 22 Nov: a plain bar on every
// screen but a health detail, the hero keeps its picture and shares the bar's Back position, and
// the five tab titles are 20.
const header = new URL('../src/shared/ui/PageHeader.tsx', import.meta.url).href;
const stubs = new URL('./fixtures/header-render-stubs.ts', import.meta.url).href;
const stubbed = new Set([
  'react-native',
  './AppText',
  './IconButton',
  './Stack',
  '../theme/ThemeProvider',
]);
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === header && stubbed.has(specifier)) {
      return { url: stubs, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const server = 'react-dom/server';
const { renderToStaticMarkup } = (await import(server)) as {
  renderToStaticMarkup: (element: ReactElement) => string;
};
const { PageHeader } = (await import(header)) as { PageHeader: (props: never) => ReactElement };
const noop = () => {};
const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(PageHeader as never, props));
const decode = (text: string) => text.replace(/&quot;/g, '"');
const styleOf = (html: string, nth = 0) => {
  const found = [...html.matchAll(/data-style="([^"]*)"/g)].map((m) => m[1]!)[nth];
  assert.ok(found, 'no style found');
  return JSON.parse(decode(found)) as Record<string, number | string>;
};
const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('the plain bar and the health hero put Back at the same inset, offset and hit size', () => {
  const bar = render({ title: 'Sleep', onBack: noop });
  const hero = render({ mode: 'hero', title: 'Sleep', onBack: noop });
  // The bar: its row's left padding and top padding place the Back icon; the hero: absolute left/top.
  const barRow = styleOf(bar);
  const heroRow = styleOf(hero);
  assert.equal(barRow.paddingHorizontal, headerMetrics.back.left);
  assert.equal(heroRow.left, headerMetrics.back.left);
  assert.equal(barRow.paddingVertical, headerMetrics.back.top);
  assert.equal(heroRow.top, headerMetrics.back.top);
  for (const html of [bar, hero]) {
    assert.match(html, /data-icon="back"/);
    assert.match(html, new RegExp(`data-width="${sizes.touchTarget}" data-height="${sizes.touchTarget}"`));
  }
  assert.equal(headerMetrics.back.width, sizes.touchTarget);
  assert.equal(headerMetrics.back.height, sizes.touchTarget);
});

test('the metrics come from the theme tokens', () => {
  assert.equal(headerMetrics.sidePadding, spacing.lg);
  assert.equal(headerMetrics.barPaddingVertical, spacing.md);
  assert.equal(headerMetrics.back.left, headerMetrics.sidePadding);
  assert.equal(headerMetrics.back.top, headerMetrics.barPaddingVertical);
});

test('Back is announced as "Back" unless a screen names where it goes', () => {
  assert.equal(BACK_LABEL, 'Back');
  assert.match(render({ title: 'Programs', onBack: noop }), /aria-label="Back"/);
  assert.match(render({ mode: 'hero', title: 'Sleep', onBack: noop }), /aria-label="Back"/);
  assert.match(
    render({ title: 'Guided', onBack: noop, backLabel: 'Back to session' }),
    /aria-label="Back to session"/,
  );
  assert.doesNotMatch(render({ title: 'Home' }), /IconButton/);
});

test('a title is 20 bold, one line, and cannot wrap under the Back icon', () => {
  const html = render({ title: 'A very long title that would otherwise wrap under the Back icon', onBack: noop });
  assert.match(html, /data-variant="pageTitle" data-lines="1"/);
  assert.deepEqual(
    { fontSize: typography.pageTitle.fontSize, fontWeight: typography.pageTitle.fontWeight },
    { fontSize: 20, fontWeight: '700' },
  );
  // The title's box takes the room left and may shrink below its text, so the text truncates.
  assert.equal(styleOf(html, 1).flex, 1);
  assert.equal(styleOf(html, 1).minWidth, 0);
});

test('actions sit at the right of the bar, after the title', () => {
  const html = render({ title: 'Day', onBack: noop, actions: createElement('i', null, 'ACT') });
  assert.ok(html.indexOf('Day') < html.indexOf('ACT'));
});

test('a tab header has no Back, no rule and the same title token', () => {
  const html = render({ title: 'Nutrition', landing: true });
  assert.match(html, /data-variant="pageTitle"/);
  assert.equal(styleOf(html).borderBottomWidth, 0);
  assert.equal(styleOf(html).paddingVertical, headerMetrics.landingPaddingVertical);
});

test('every layout draws its header through PageHeader', async () => {
  assert.match(await read('shared/ui/PageLayout.tsx'), /<PageHeader\b/);
  assert.match(await read('shared/ui/HealthHero.tsx'), /<PageHeader mode="hero"/);
  const detail = await read('shared/ui/HealthDetailLayout.tsx');
  assert.match(detail, /<HealthHero\b/);
  const workout = await read('features/workouts/components/WorkoutLayout.tsx');
  assert.match(workout, /<PageLayout\b/);
  const page = await read('shared/ui/PageLayout.tsx');
  assert.doesNotMatch(page, /\bheader\??:/, 'no custom header slot is left');
  assert.doesNotMatch(page, /IconButton/, 'PageLayout draws no Back control of its own');
});

test('WorkoutLayout defaults Back to "Back"; only the guided session keeps "Back to session"', async () => {
  const workout = await read('features/workouts/components/WorkoutLayout.tsx');
  assert.doesNotMatch(workout, /backLabel = 'Back to session'/);
  assert.doesNotMatch(workout, /backLabel = /, 'no default of its own: the header supplies "Back"');
  const guided = await read('features/workouts/screens/GuidedWorkoutScreen.tsx');
  assert.match(guided, /'Back to session'/);
  for (const file of [
    'features/programs/ProgramsScreen.tsx',
    'features/programs/ProgramEditor.tsx',
    'features/workouts/screens/SessionExplainScreen.tsx',
    'features/workouts/screens/ExerciseLibraryScreen.tsx',
  ]) {
    assert.doesNotMatch(await read(file), /Back to session/, file);
  }
});

test('the five tabs take their title size from the one constant', async () => {
  for (const file of [
    'features/home/screens/HomeScreen.tsx',
    'features/health/screens/HealthScreen.tsx',
    'features/workouts/screens/WorkoutScreen.tsx',
    'features/nutrition/screens/NutritionScreen.tsx',
    'features/settings/screens/MoreScreen.tsx',
  ]) {
    const source = await read(file);
    assert.match(source, /<PageLayout\b/, file);
    assert.doesNotMatch(source, /titleVariant|nutritionTitle/, `${file} picks its own title size`);
  }
  assert.equal(headerMetrics.titleVariant, 'pageTitle');
  assert.equal(typography.pageTitle.fontSize, 20);
  assert.equal('nutritionTitle' in typography, false);
  assert.match(await read('shared/ui/PageHeader.tsx'), /variant=\{m\.titleVariant\}/);
});

test('Settings and Health Connect render the shared header, and the old Screen fallback is gone', async () => {
  const app = await read('app/App.tsx');
  assert.doesNotMatch(app, /<Screen\b/);
  assert.doesNotMatch(app, /import \{[^}]*\bScreen\b[^}]*\} from '..\/shared\/ui'/);
  const block = app.slice(app.indexOf("case 'health-data':"));
  assert.match(block.slice(0, 600), /<PageLayout[\s\S]*onBack=\{back\}/);
  assert.match(app, /const fullScreen = !!current;/, 'Settings hides the tab bar, like About');
});
