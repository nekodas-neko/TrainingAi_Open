import assert from 'node:assert/strict';
import { test } from 'node:test';
import { here, loadDom, type Dom } from './fixtures/dom-harness.ts';

// #4099: a Sheet closed in the same commit that hides its screen (React `Activity`, what
// `RetainedView` uses for every screen the app keeps alive) stayed presented, over the screen that
// opened next. The real Sheet and ScreenBoundary run here under react-native-web in jsdom, both
// devDependencies of this project: a missing one fails this file, it does not skip it.
const sheet = here('../../src/shared/ui/Sheet.tsx');
const boundary = here('../../src/shared/ui/ScreenBoundary.tsx');
const stubs = here('./sheet-dom-stubs.ts');
const dom: Dom = await loadDom([
  {
    from: sheet,
    to: stubs,
    specifiers: [
      './ReorderScrollView',
      './IconButton',
      './AppText',
      './Stack',
      './useReducedMotion',
      '../../integrations/feedback/haptics',
      '../theme/ThemeProvider',
      'react-native-safe-area-context',
    ],
  },
  {
    from: boundary,
    to: stubs,
    specifiers: [
      './PageLayout',
      './StateCard',
      './AppButton',
      './ConfirmationCard',
      '../../core/reporting/index.ts',
    ],
  },
]);
const { Sheet } = await import(sheet);
const { ScreenBoundary } = await import(boundary);
const { reported } = await import('./fixtures/sheet-dom-stubs.ts');
const api = { ...dom, Sheet, ScreenBoundary, reported };

const wait = dom.wait;
const shown = () => document.body.textContent!.includes('Log Activity');
let closedEvents = 0;
const screenWith = (open: boolean, active: boolean) => {
  const { h, Activity, Sheet } = api;
  return h(
    Activity,
    { mode: active ? 'visible' : 'hidden' },
    h(Sheet, { visible: open, title: 'Log Activity', onClose() {}, onDismiss: () => closedEvents++ }, h('div', null, 'tiles')),
  );
};
const draw = async (open: boolean, active: boolean, settle = 500) => {
  await api.act(async () => api.root.render(screenWith(open, active)));
  await api.act(async () => wait(settle));
};

test('closing the sheet and hiding its screen in one commit leaves no sheet behind', async () => {
  await draw(true, true);
  assert.equal(shown(), true);
  await draw(false, false, 800);
  assert.equal(shown(), false);
  await draw(false, true);
  assert.equal(shown(), false, 'and none comes back when the screen is shown again');
});

test('closed first, hidden after: the sheet reports its close, then the screen can go', async () => {
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

test('a sheet still open when its screen is hidden does not stay over the next screen, and returns with it', async () => {
  await draw(true, true);
  await draw(true, false);
  assert.equal(shown(), false);
  await draw(true, true);
  assert.equal(shown(), true);
  await draw(false, true);
});

test('a screen that throws while drawing shows the error card and reports it', async () => {
  const { h, ScreenBoundary, act, root, reported } = api;
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

// #4099 item 4: a session left by a crash whose screen throws can be discarded from the boundary,
// after which the hub's start controls work again. The real store, the real boundary.
const { ActivityStore } = await import('../src/features/activities/data/ActivityStore.ts');
const { pickActivity } = await import('../src/features/activities/data/pick-activity.ts');
test('a session that makes the activity screen throw can be discarded from the boundary, then a new activity starts', async () => {
  const values = new Map<string, string>();
  let n = 0;
  const store = new ActivityStore(
    {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string) => void values.set(key, value),
      remove: async (key: string) => void values.delete(key),
    },
    {
      origin: 'https://example.com',
      userId: 'one',
      timezone: 'Australia/Brisbane',
      get: async () => ({ activityLogs: [] }),
      post: async () => ({ processed: 1, errors: [] }),
    } as never,
    () => `10000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    () => {},
    () => Date.now(),
  );
  await store.initialize();
  const treadmill = { id: 'treadmill', label: 'Treadmill', icon: 'PersonSimpleWalk', isDistanceBased: false };
  await store.start(treadmill);
  assert.ok(store.getSnapshot().session, 'the leftover session');
  const { h, ScreenBoundary, act, root, click } = api;
  const Broken = () => {
    if (store.getSnapshot().session) throw new Error('leftover session cannot draw');
    return h('p', null, 'no activity');
  };
  const quiet = console.error;
  console.error = () => {};
  let backed = 0;
  await act(async () =>
    root.render(
      h(
        ScreenBoundary,
        { title: 'Activity', screen: 'activity-recording', onBack: () => backed++, onDiscard: () => store.discard() },
        h(Broken),
      ),
    ),
  );
  console.error = quiet;
  assert.match(document.body.textContent!, /This screen could not open/);
  await click('Discard activity');
  assert.equal(store.getSnapshot().session !== null, true, 'a confirm step first: nothing discarded yet');
  assert.match(document.body.textContent!, /Keep activity/);
  await click('Discard');
  assert.equal(store.getSnapshot().session, null);
  assert.equal(backed, 1);
  // The hub's start controls now work: one start, no "Resume or discard" refusal.
  const log: string[] = [];
  await pickActivity(
    { current: false },
    {
      store,
      hasSession: !!store.getSnapshot().session,
      closeSheet: () => log.push('close'),
      afterSheet: (_next, settled) => (log.push('armed'), settled()),
      openActivity: () => {},
      inProgress: () => log.push('in-progress'),
      setBusy: () => {},
      setError: (m) => m && log.push(`error:${m}`),
    },
    treadmill,
  );
  assert.deepEqual(log, ['armed', 'close']);
  assert.ok(store.getSnapshot().session);
});

// #4099 item 7: what a hidden screen keeps. State held by the component that renders the Sheet
// survives (Activity keeps it) while the Sheet's own children are dropped with the Modal; state
// inside a child is lost. The weekly check-in (answers) and the food logger (the My Foods filter)
// are built the first way; these model that shape with the real Sheet.
function twoScreens(open: boolean, active: boolean, typed: { answers: string; filter: string }, set: (k: 'answers' | 'filter', v: string) => void) {
  const { h, Activity, Sheet } = api;
  const Field = ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
    h('input', { value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) });
  return h(
    Activity,
    { mode: active ? 'visible' : 'hidden' },
    h(
      Sheet,
      { visible: open, title: 'Weekly', onClose() {} },
      h(Field, { value: typed.answers, onChange: (v: string) => set('answers', v) }),
      h(Field, { value: typed.filter, onChange: (v: string) => set('filter', v) }),
    ),
  );
}
test('typed text held by the screen survives that screen being hidden with the sheet open (weekly check-in, food logger filter)', async () => {
  const typed = { answers: 'slept badly', filter: 'oat' };
  const set = (k: 'answers' | 'filter', v: string) => void (typed[k] = v);
  const draw = async (active: boolean) => {
    await api.act(async () => api.root.render(twoScreens(true, active, typed, set)));
    await api.act(async () => wait(300));
  };
  await draw(true);
  const values = () => [...document.querySelectorAll('input')].map((i) => (i as HTMLInputElement).value);
  assert.deepEqual(values(), ['slept badly', 'oat']);
  await draw(false);
  assert.equal(document.querySelectorAll('input').length, 0, 'no sheet over the next screen');
  await draw(true);
  assert.deepEqual(values(), ['slept badly', 'oat'], 'back on return, with what was typed');
  await api.act(async () => api.root.render(twoScreens(false, true, typed, set)));
  await api.act(async () => wait(400));
});
