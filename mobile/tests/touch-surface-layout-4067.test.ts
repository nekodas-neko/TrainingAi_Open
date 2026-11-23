import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';

// #4067: the rendered tree's resolved styles. React Native's layout engine cannot run here, so this
// shows which box carries which style key; the measured check in a browser covers the layout.
const dir = (path: string) => new URL(path, import.meta.url).href;
const surface = dir('../src/shared/ui/TouchSurface.tsx');
const row = dir('../src/features/health/components/PeriodizationRow.tsx');
const stubs = dir('./fixtures/layout-render-stubs.ts');
const realSurface = dir('./fixtures/layout-real-touch-surface.ts');
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === surface && ['react-native', './Pressable', './useReducedMotion'].includes(specifier))
      return { url: stubs, shortCircuit: true };
    if (context.parentURL === row) {
      if (specifier === '../../../shared/theme/ThemeProvider') return { url: stubs, shortCircuit: true };
      if (specifier === '../../workouts/components/SessionGlyph') return { url: stubs, shortCircuit: true };
      if (specifier === '../../../shared/ui') return { url: realSurface, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const server = 'react-dom/server';
const { renderToStaticMarkup } = (await import(server)) as {
  renderToStaticMarkup: (element: ReactElement) => string;
};
const { TouchSurface } = await import(surface);
const { PeriodizationRow } = await import(row);
const { parse, find, ancestors } = await import(stubs);
type Node = import('./fixtures/layout-render-stubs.ts').Node;

const render = (element: ReactElement) => parse(renderToStaticMarkup(element));
const byUi = (tree: Node, ui: string) => find(tree, (n: Node) => n.ui === ui);
const PLACEMENT = ['flex', 'flexGrow', 'flexShrink', 'flexBasis', 'minWidth', 'marginTop', 'alignSelf'];

test('a surface asked to fill a row: the wrapper grows and shrinks, the Pressable holds no placement key', () => {
  const tree = render(createElement(TouchSurface, { style: { flex: 1, minWidth: 0, padding: 12 } }));
  const [wrapper] = byUi(tree, 'Animated.View');
  const [pressable] = byUi(tree, 'Pressable');
  assert.equal(wrapper.style.flexGrow, 1);
  assert.equal(wrapper.style.flexShrink, 1);
  assert.equal(wrapper.style.minWidth, 0);
  assert.equal(wrapper.style.flex, undefined);
  assert.equal(pressable.style.padding, 12);
  for (const key of PLACEMENT.filter((k) => k !== 'flexGrow')) assert.equal(key in pressable.style, false, key);
  // The Pressable fills the wrapper it sits in.
  assert.equal(pressable.style.flexGrow, 1);
});

test('a function style is split on what it returns: placement to the wrapper, the look to the Pressable', () => {
  const tree = render(
    createElement(TouchSurface, {
      style: ({ pressed }: { pressed: boolean }) => ({ flex: 1, marginTop: 4, opacity: pressed ? 0.5 : 1 }),
    }),
  );
  const [wrapper] = byUi(tree, 'Animated.View');
  const [pressable] = byUi(tree, 'Pressable');
  assert.equal(wrapper.style.flexGrow, 1);
  assert.equal(wrapper.style.marginTop, 4);
  assert.equal(pressable.style.opacity, 1);
  for (const key of ['flex', 'flexShrink', 'marginTop']) assert.equal(key in pressable.style, false, key);
});

test('a pressed-dependent placement key follows the press state', async () => {
  const { resolveTouchSurfaceStyle } = await import('../src/shared/ui/touchSurfaceLayout.ts');
  const style = ({ pressed }: { pressed: boolean }) => ({ marginTop: pressed ? 2 : 0, opacity: pressed ? 0.5 : 1 });
  assert.deepEqual(resolveTouchSurfaceStyle(style, true), { outer: { marginTop: 2 }, inner: { opacity: 0.5 } });
  assert.deepEqual(resolveTouchSurfaceStyle(style, false), { outer: { marginTop: 0 }, inner: { opacity: 1 } });
});

test('a surface with no style is content-sized: the wrapper does not grow', () => {
  const [wrapper] = byUi(render(createElement(TouchSurface, {})), 'Animated.View');
  assert.equal(wrapper.style.flexGrow, 0);
});

test('Periodization row: the text column sits in a wrapper that takes the row width beside the button', () => {
  const session = {
    sessionId: 's1',
    sessionName: 'Upper Body Hypertrophy',
    icon: null,
    lastTrainedDaysAgo: 2,
    state: { phase: 'baseline', baselineComplete: false, sessionsInPhase: 0 },
  };
  const tree = render(
    createElement(PeriodizationRow, {
      session,
      phaseColors: {},
      busy: false,
      disabled: false,
      onOpen: () => {},
      onApplyPriorData: () => {},
    }),
  );
  const [name] = find(tree, (n: Node) => n.ui === 'AppText' && n.text.includes('Upper Body Hypertrophy'));
  const [phase] = find(tree, (n: Node) => n.ui === 'AppText' && n.text.includes('Baseline needed'));
  assert.ok(name && phase, 'session name and phase line are rendered');
  const chain = ancestors(name);
  const wrapper = chain.find((n: Node) => n.ui === 'Animated.View');
  const pressable = chain.find((n: Node) => n.ui === 'Pressable');
  assert.ok(wrapper && pressable);
  // The wrapper is the outer row's direct child, next to the "use prior data" button.
  assert.equal(wrapper.parent?.ui, 'Stack');
  assert.equal(wrapper.parent?.direction, 'row');
  assert.equal(byUi(wrapper.parent as Node, 'AppButton').length, 1);
  assert.equal(wrapper.style.flexGrow, 1);
  assert.equal(wrapper.style.flexShrink, 1);
  assert.equal(wrapper.style.minWidth, 0);
  // Nothing between the wrapper and the text column puts a placement key on the Pressable.
  for (const key of ['flex', 'flexShrink', 'minWidth']) assert.equal(key in pressable.style, false, key);
  assert.equal(pressable.parent, wrapper);
  // The text column itself may shrink to the space it is given and truncate.
  assert.equal(name.parent?.style.flex, 1);
  assert.equal(name.parent?.style.minWidth, 0);
});
