import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';
import ts from 'typescript';
import { sizes, spacing, typography } from '../src/shared/theme/tokens.ts';
import { BACK_LABEL, headerMetrics } from '../src/shared/ui/headerMetrics.ts';

// #3760. One page header, in two modes. The owner picked A A A on 22 Nov: a plain bar on every
// screen but a health detail, the hero keeps its picture and shares the bar's Back position, and
// the five tab titles are 20. These tests render the real header, IconButton, PageLayout,
// WorkoutLayout and HealthDetailLayout; only the native boxes underneath are stand-ins.
const ui = (name: string) => new URL(`../src/shared/ui/${name}`, import.meta.url).href;
const subjects = new Set([
  ui('PageHeader.tsx'),
  ui('IconButton.tsx'),
  ui('PageLayout.tsx'),
  ui('HealthHero.tsx'),
  ui('HealthDetailLayout.tsx'),
  new URL('../src/features/workouts/components/WorkoutLayout.tsx', import.meta.url).href,
]);
const stubs = new URL('./fixtures/header-render-stubs.ts', import.meta.url).href;
const barrel = new URL('./fixtures/header-render-barrel.ts', import.meta.url).href;
const stubbed = new Set([
  'react-native',
  'react-native-svg',
  './AppText',
  './Stack',
  './Pressable',
  './Icon',
  './useAndroidBack',
  './ReorderScrollView',
  './NestedScrollGesture',
  './HealthArtwork',
  './PageGradient',
  './WorkoutClocks',
  '../theme/ThemeProvider',
]);
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL && subjects.has(context.parentURL)) {
      if (stubbed.has(specifier)) return { url: stubs, shortCircuit: true };
      if (specifier === '../../../shared/ui') return { url: barrel, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const server = 'react-dom/server';
const { renderToStaticMarkup } = (await import(server)) as {
  renderToStaticMarkup: (element: ReactElement) => string;
};
type Component = (props: never) => ReactElement;
const { PageHeader } = (await import(ui('PageHeader.tsx'))) as { PageHeader: Component };
const { PageLayout } = (await import(ui('PageLayout.tsx'))) as { PageLayout: Component };
const { HealthDetailLayout } = (await import(ui('HealthDetailLayout.tsx'))) as {
  HealthDetailLayout: Component;
};
const { WorkoutLayout } = (await import(
  new URL('../src/features/workouts/components/WorkoutLayout.tsx', import.meta.url).href
)) as { WorkoutLayout: Component };
const noop = () => {};
const render = (component: Component, props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(component as never, props));
const decode = (text: string) => text.replace(/&quot;/g, '"');
type Style = Record<string, number | string>;
const styles = (html: string) =>
  [...html.matchAll(/data-style="([^"]*)"/g)].map((m) => JSON.parse(decode(m[1]!)) as Style);
const firstStyle = (html: string) => {
  const found = styles(html)[0];
  assert.ok(found, 'no style found');
  return found;
};
/** The tag of an element, by its markup, so a test can read its aria-label and data attributes. */
const tags = (html: string, ui: string) =>
  [...html.matchAll(new RegExp(`<[a-z]+ [^>]*data-ui="${ui}"[^>]*>`, 'g'))].map((m) => m[0]);
const styleOfTag = (tag: string) => JSON.parse(decode(/data-style="([^"]*)"/.exec(tag)![1]!)) as Style;

/** The real IconButton, rendered: the size every Back gets. */
const backButton = (html: string) => {
  const tag = tags(html, 'Pressable').find((t) => /aria-label="[^"]*"/.test(t));
  assert.ok(tag, 'no Back button rendered');
  return { tag, style: styleOfTag(tag) };
};
/**
 * Where the bar puts Back from the top of its row: the row's top padding, plus nothing when Back is
 * pinned to the top (alignSelf flex-start). A tall title block cannot move it; centring would.
 */
const barBackTop = (html: string) => {
  const row = styles(html).find((s) => 'paddingVertical' in s)!;
  const wrapper = styles(html).find((s) => s.alignSelf === 'flex-start');
  assert.ok(wrapper, 'Back is not pinned to the top of the bar');
  assert.equal(row.alignItems, 'flex-start');
  return row.paddingVertical as number;
};
const rich = { subtitle: 'Wednesday 30 September', detail: 'Phase 2 · Strength block' };

test('the plain bar and the health hero put Back at the same inset and offset', () => {
  const bar = render(PageHeader, { title: 'Sleep', onBack: noop });
  const hero = render(PageHeader, { mode: 'hero', title: 'Sleep', onBack: noop });
  const heroRow = firstStyle(hero);
  const barRow = firstStyle(bar);
  assert.equal(barRow.paddingHorizontal, headerMetrics.back.left);
  assert.equal(heroRow.left, headerMetrics.back.left);
  assert.equal(barRow.paddingVertical, headerMetrics.back.top);
  assert.equal(heroRow.top, headerMetrics.back.top);
  assert.match(bar, /data-icon="back"/);
  assert.match(hero, /data-icon="back"/);
});

test('Back is the real IconButton at the touch target, in both modes', () => {
  for (const props of [
    { title: 'Sleep', onBack: noop },
    { mode: 'hero', title: 'Sleep', onBack: noop },
  ]) {
    const { style } = backButton(render(PageHeader, props));
    assert.equal(style.width, sizes.touchTarget);
    assert.equal(style.height, sizes.touchTarget);
  }
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
  assert.match(render(PageHeader, { title: 'Programs', onBack: noop }), /aria-label="Back"/);
  assert.match(
    render(PageHeader, { mode: 'hero', title: 'Sleep', onBack: noop }),
    /aria-label="Back"/,
  );
  assert.match(
    render(PageHeader, { title: 'Guided', onBack: noop, backLabel: 'Back to session' }),
    /aria-label="Back to session"/,
  );
  assert.equal(tags(render(PageHeader, { title: 'Home' }), 'Pressable').length, 0);
});

test('a title is 20 bold, one line, and cannot wrap under the Back icon', () => {
  const html = render(PageHeader, {
    title: 'A very long title that would otherwise wrap under the Back icon',
    onBack: noop,
  });
  assert.match(html, /data-variant="pageTitle" data-lines="1"/);
  assert.deepEqual(
    { fontSize: typography.pageTitle.fontSize, fontWeight: typography.pageTitle.fontWeight },
    { fontSize: 20, fontWeight: '700' },
  );
  const block = styles(html).find((s) => s.flex === 1)!;
  assert.equal(block.minWidth, 0);
});

test('actions sit at the right of the bar, after the title', () => {
  const html = render(PageHeader, {
    title: 'Day',
    onBack: noop,
    actions: createElement('i', null, 'ACT'),
  });
  assert.ok(html.indexOf('Day') < html.indexOf('ACT'));
});

test('a tab header has no Back, no rule and the same title token', () => {
  const html = render(PageHeader, { title: 'Nutrition', landing: true });
  assert.match(html, /data-variant="pageTitle"/);
  assert.equal(firstStyle(html).borderBottomWidth, 0);
  assert.equal(firstStyle(html).paddingVertical, headerMetrics.landingPaddingVertical);
});

test('a title block taller than Back does not move Back or grow the bar upward', () => {
  const plain = render(PageHeader, { title: 'Session', onBack: noop });
  const tall = render(PageHeader, { title: 'Session', onBack: noop, ...rich });
  assert.equal(barBackTop(tall), barBackTop(plain));
  assert.equal(barBackTop(plain), headerMetrics.back.top);
  // The title block is at least as tall as Back and centres its text, so the first line is level
  // with Back; extra lines extend the bar downward only.
  for (const html of [plain, tall]) {
    const block = styles(html).find((s) => s.flex === 1)!;
    assert.equal(block.minHeight, backButton(html).style.height);
    assert.equal(block.justifyContent, 'center');
  }
  // Right-hand items share that first row, so they stay level with Back too.
  const withActions = render(PageHeader, {
    title: 'Session',
    onBack: noop,
    ...rich,
    actions: createElement('i', null, 'ACT'),
    trailing: createElement('i', null, 'TIMER'),
  });
  assert.equal(styles(withActions).filter((s) => s.minHeight === sizes.touchTarget).length, 3);
});

test('PageLayout draws the shared header, with Back at the same offset whatever the title holds', () => {
  const plain = render(PageLayout, { title: 'About', onBack: noop });
  const tall = render(PageLayout, { title: 'Session', onBack: noop, ...rich });
  assert.match(plain, /aria-label="Back"/);
  assert.match(plain, /data-variant="pageTitle"/);
  assert.equal(barBackTop(tall), barBackTop(plain));
});

test('WorkoutLayout draws the shared header; a subtitle and detail do not move Back', () => {
  const plain = render(WorkoutLayout, { title: 'About', onBack: noop });
  const session = render(WorkoutLayout, {
    title: 'Upper A',
    subtitle: 'Wednesday 30 September',
    detail: 'Phase 2 · Strength block',
    onBack: noop,
    workout: {},
    actions: createElement('i', null, 'ACT'),
  });
  assert.match(session, /aria-label="Back"/, 'defaults to "Back"');
  assert.match(session, /data-ui="SessionTimer"/);
  assert.equal(barBackTop(session), barBackTop(plain));
  const stage = render(WorkoutLayout, {
    title: 'Upper A',
    subtitle: 'Phase 2 · Ex 1/6',
    subtitleNode: createElement('b', null, 'New Personal Record!'),
    onBack: noop,
    backLabel: 'Back to session',
  });
  assert.match(stage, /aria-label="Back to session"/);
  assert.equal(barBackTop(stage), barBackTop(plain));
});

test('HealthDetailLayout draws the hero header with Back where the bar puts it', () => {
  const html = render(HealthDetailLayout, {
    title: 'Sleep',
    kind: 'sleep',
    onBack: noop,
    hero: createElement('i', null, 'RING'),
  });
  assert.match(html, /aria-label="Back"/);
  const heroRow = styles(html).find((s) => s.position === 'absolute' && s.right === headerMetrics.sidePadding);
  assert.ok(heroRow, 'no hero header row');
  assert.equal(heroRow.left, headerMetrics.back.left);
  assert.equal(heroRow.top, headerMetrics.back.top);
  const bar = render(PageLayout, { title: 'About', onBack: noop });
  assert.equal(heroRow.top, barBackTop(bar));
  assert.equal(backButton(html).style.height, backButton(bar).style.height);
});

test('Settings and Health Connect are drawn by PageLayout with Back, and hide the tab bar', async () => {
  // App cannot be mounted here, so read its syntax tree rather than its text.
  const path = new URL('../src/app/App.tsx', import.meta.url);
  const file = ts.createSourceFile(
    'App.tsx',
    await readFile(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found: { layout: boolean; onBack: boolean; screens: string[] } | undefined;
  let usesScreen = false;
  let fullScreen = '';
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText() === 'Screen') usesScreen = true;
    }
    if (ts.isVariableDeclaration(node) && node.name.getText() === 'fullScreen') {
      fullScreen = node.initializer?.getText() ?? '';
    }
    if (ts.isCaseClause(node) && node.expression.getText() === "'settings'") {
      const clauses = (node.parent as ts.CaseBlock).clauses;
      const screens = clauses
        .slice(clauses.indexOf(node) - 1, clauses.indexOf(node) + 1)
        .map((c) => (ts.isCaseClause(c) ? c.expression.getText() : ''));
      let layout = false;
      let onBack = false;
      const inner = (n: ts.Node) => {
        if (ts.isJsxOpeningElement(n) && n.tagName.getText() === 'PageLayout') {
          layout = true;
          onBack = n.attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === 'onBack');
        }
        ts.forEachChild(n, inner);
      };
      inner(node);
      found = { layout, onBack, screens };
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.deepEqual(found, { layout: true, onBack: true, screens: ["'health-data'", "'settings'"] });
  assert.equal(usesScreen, false, 'App no longer draws the old Screen header');
  assert.equal(fullScreen, '!!current', 'a pushed screen hides the tab bar, as About does');
});

test('the five tabs take their title size from the one constant', async () => {
  const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
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
  assert.match(render(PageHeader, { title: 'Nutrition', landing: true }), /data-variant="pageTitle"/);
});

test('only the guided session keeps "Back to session"; screens that name a place keep their label', async () => {
  const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
  assert.match(await read('features/workouts/screens/GuidedWorkoutScreen.tsx'), /'Back to session'/);
  for (const file of [
    'features/programs/ProgramsScreen.tsx',
    'features/programs/ProgramEditor.tsx',
    'features/workouts/screens/SessionExplainScreen.tsx',
    'features/workouts/screens/ExerciseLibraryScreen.tsx',
  ]) {
    assert.doesNotMatch(await read(file), /Back to session/, file);
  }
});
