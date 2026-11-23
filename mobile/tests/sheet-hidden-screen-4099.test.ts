import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { test } from 'node:test';
import { existsSync } from 'node:fs';

// #4099: a Sheet closed in the same commit that hides its screen (React `Activity`, what
// `RetainedView` uses for every screen the app keeps alive) stayed presented, over the screen that
// opened next. The real Sheet runs here under react-native-web in jsdom. jsdom is not a dependency
// of this project: it is read from the repository root's install, and these tests are skipped
// where that is absent (the mobile CI job installs only this directory).
const jsdomPath = new URL('../../node_modules/jsdom/lib/api.js', import.meta.url);
const skip = existsSync(jsdomPath) ? false : 'jsdom is not installed at the repository root';

const dir = (path: string) => new URL(path, import.meta.url).href;
const sheet = dir('../src/shared/ui/Sheet.tsx');
const boundary = dir('../src/shared/ui/ScreenBoundary.tsx');
const stubs = dir('./fixtures/sheet-dom-stubs.ts');
type Api = {
  act: (fn: () => Promise<unknown> | void) => Promise<void>;
  root: { render(element: unknown): void };
  h: (...args: unknown[]) => unknown;
  Activity: unknown;
  Sheet: unknown;
  ScreenBoundary: unknown;
  reported: unknown[];
};
let api: Api | undefined;
if (!skip) {
  const rnw = dir(createRequire(import.meta.url).resolve('react-native-web').replace(/^/, 'file://'));
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'react-native') return { url: rnw, shortCircuit: true };
      if (
        context.parentURL === sheet &&
        [
          './ReorderScrollView',
          './IconButton',
          './AppText',
          './Stack',
          './useReducedMotion',
          '../../integrations/feedback/haptics',
          '../theme/ThemeProvider',
          'react-native-safe-area-context',
        ].includes(specifier)
      )
        return { url: stubs, shortCircuit: true };
      if (
        context.parentURL === boundary &&
        ['./PageLayout', './StateCard', '../../core/reporting/index.ts'].includes(specifier)
      )
        return { url: stubs, shortCircuit: true };
      return next(specifier, context);
    },
  });
  const { JSDOM } = await import(jsdomPath.href);
  const dom = new JSDOM('<!doctype html><div id=root></div>', { pretendToBeVisual: true });
  const w = dom.window;
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    HTMLElement: w.HTMLElement,
    Element: w.Element,
    Node: w.Node,
    ShadowRoot: w.ShadowRoot,
    MutationObserver: w.MutationObserver,
    getComputedStyle: w.getComputedStyle.bind(w),
    requestAnimationFrame: w.requestAnimationFrame.bind(w),
    cancelAnimationFrame: w.cancelAnimationFrame.bind(w),
  });
  const warn = console.warn;
  console.warn = () => {};
  const React = await import('react');
  // A variable specifier: this directory has no types for react-dom.
  const client = 'react-dom/client';
  const { createRoot } = (await import(client)) as {
    createRoot: (node: unknown) => Api['root'];
  };
  api = {
    act: (React as unknown as { act: Api['act'] }).act,
    root: createRoot(w.document.getElementById('root')),
    h: React.createElement as Api['h'],
    Activity: (React as unknown as { Activity: unknown }).Activity,
    Sheet: (await import(sheet)).Sheet,
    ScreenBoundary: (await import(boundary)).ScreenBoundary,
    reported: (await import('./fixtures/sheet-dom-stubs.ts')).reported,
  };
  console.warn = warn;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shown = () => document.body.textContent!.includes('Log Activity');
let closedEvents = 0;
const screenWith = (open: boolean, active: boolean) => {
  const { h, Activity, Sheet } = api!;
  return h(
    Activity,
    { mode: active ? 'visible' : 'hidden' },
    h(Sheet, { visible: open, title: 'Log Activity', onClose() {}, onDismiss: () => closedEvents++ }, h('div', null, 'tiles')),
  );
};
const draw = async (open: boolean, active: boolean, settle = 500) => {
  await api!.act(async () => api!.root.render(screenWith(open, active)));
  await api!.act(async () => wait(settle));
};

test('closing the sheet and hiding its screen in one commit leaves no sheet behind', { skip }, async () => {
  await draw(true, true);
  assert.equal(shown(), true);
  await draw(false, false, 800);
  assert.equal(shown(), false);
  await draw(false, true);
  assert.equal(shown(), false, 'and none comes back when the screen is shown again');
});

test('closed first, hidden after: the sheet reports its close, then the screen can go', { skip }, async () => {
  await draw(true, true);
  closedEvents = 0;
  await draw(false, true, 500);
  assert.equal(shown(), false);
  // react-native-web's Modal reports a dismissal as well as the Sheet, so twice here; on Android
  // only the Sheet does. Either way `openAfterClose` runs the navigation once.
  const reported = closedEvents;
  assert.ok(reported >= 1, 'onDismiss fires when the close has finished');
  await draw(false, false);
  assert.equal(shown(), false);
  assert.equal(closedEvents, reported, 'hiding the screen afterwards reports nothing more');
});

test('a sheet still open when its screen is hidden does not stay over the next screen, and returns with it', { skip }, async () => {
  await draw(true, true);
  await draw(true, false);
  assert.equal(shown(), false);
  await draw(true, true);
  assert.equal(shown(), true);
  await draw(false, true);
});

test('a screen that throws while drawing shows the error card and reports it', { skip }, async () => {
  const { h, ScreenBoundary, act, root, reported } = api!;
  const Broken = () => {
    throw new Error('icon is undefined');
  };
  const quiet = console.error;
  console.error = () => {};
  let backed = 0;
  await act(async () =>
    root.render(
      h(ScreenBoundary, { title: 'Activity', screen: 'activity-recording', onBack: () => backed++ }, h(Broken)),
    ),
  );
  console.error = quiet;
  assert.match(document.body.textContent!, /This screen could not open \/ Go back/);
  assert.equal(reported.length, 1);
  assert.equal((reported[0] as Error).message, 'icon is undefined');
});
