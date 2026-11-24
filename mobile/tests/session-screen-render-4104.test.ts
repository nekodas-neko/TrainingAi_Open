import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { load, loadCard, render } from './fixtures/session-screen-harness.ts';
import { planStartModel } from '../src/features/workouts/data/plan-start.ts';

// #4104 review. The tests of the view model alone let a mutated card and a deleted Deload link
// through. These render the real SessionScreen and the real PlanStartCard (the native boxes under
// them are stand-ins, `fixtures/plan-render-stubs.ts`) and read the markup back.
//
// The non-AI snapshot (`fixtures/session-screen-main-4104.json`) is what `origin/main`'s
// SessionScreen renders for an automatic, a manual and a no-phase program, captured with the same
// stand-ins. To capture it again:
//   git show origin/main:mobile/src/features/workouts/screens/SessionScreen.tsx \
//     > src/features/workouts/screens/SessionScreen.main.tsx
//   CAPTURE_MAIN=1 pnpm exec tsx --test tests/session-screen-render-4104.test.ts
//   rm src/features/workouts/screens/SessionScreen.main.tsx
const snapshotPath = new URL('./fixtures/session-screen-main-4104.json', import.meta.url);
const kinds = ['automatic', 'manual', ''] as const;

const lift = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Lift ${id}`,
  muscles: ['chest'],
  sets: [1, 2, 3].map((number) => ({ number, reps: 8, percent: 82.5, restSeconds: 120 })),
  setCount: 3,
  style: null,
  instructions: null,
  exerciseType: 'weighted',
  deloaded: false,
  lastWeights: [80],
  equipment: [],
  estimated1rm: 100,
  target80: null,
  latestWeight: null,
  lastSetMode: null,
  ...over,
});
const exercises = [lift('a'), lift('b'), lift('c'), lift('d')];

type Setup = {
  phaseMode: string;
  prescription?: Record<string, unknown> | null;
  status?: string;
  exercises?: unknown[];
  preparation?: Record<string, unknown>;
  workouts?: unknown[];
  pending?: boolean;
};
function setup(s: Setup) {
  const rows = s.exercises ?? exercises;
  const session = {
    id: 's1',
    name: 'Push',
    exercises: rows,
    durationMinutes: 60,
    phaseDetail: 'Accumulation · Session 1',
    phase: 'accumulation',
    prescriptionPending: !!s.pending,
    isBaseline: false,
  };
  const program = { id: 'p1', phaseMode: s.phaseMode, sessions: [session] };
  (globalThis as any).__screen = {
    workout: {
      signedIn: true,
      source: 'live',
      notice: null,
      catalog: { program, recommendation: undefined },
      timezone: 'Australia/Brisbane',
      refresh() {},
      refreshingManually: false,
    },
    journal: { data: { workouts: s.workouts ?? [] } },
    units: {},
    preparation: {
      session,
      asSent: rows,
      prescribedState: s.prescription
        ? { prescription: s.prescription, prescriptionStatus: s.status ?? 'auto_applied' }
        : undefined,
      current: { refreshing: false, saved: false, error: null },
      action: { busy: false },
      options: { aiDeload: false, fullOverride: false, revertedExerciseIds: [] },
      parseError: null,
      deload: false,
      deloadLoading: false,
      deloadFailure: null,
      refresh() {},
      ...s.preparation,
    },
  };
}
const props = { sessionId: 's1', openSettings() {}, openWorkout() {}, closeSession() {} };
const normalise = (html: string) => html.replace(/&quot;subtitle&quot;:&quot;[^&]*&quot;/g, 'SUBTITLE');
const renderScreen = async (file = 'SessionScreen.tsx') =>
  normalise(render(await load(file, 'SessionScreen'), props));
const footerOf = (html: string) => /data-ui="footer">(.*)$/.exec(html)![1]!;
const labels = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
const buttons = (html: string) =>
  [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map((m) => ({ attrs: m[1]!, label: m[2]! }));
const plan = (over: Record<string, unknown> = {}) => ({
  phase: 'accumulation',
  phaseAction: 'stay',
  reasoning: 'Your lifts moved well last week.',
  deload: false,
  estimatedSessionDurationMin: 62,
  exercises: [],
  ...over,
});

if (process.env.CAPTURE_MAIN) {
  test('capture what main renders for the other program kinds', async () => {
    const out: Record<string, string> = {};
    for (const kind of kinds) {
      setup({ phaseMode: kind, pending: kind === 'manual' });
      out[kind || 'none'] = await renderScreen('SessionScreen.main.tsx');
    }
    writeFileSync(snapshotPath, JSON.stringify(out, null, 2) + '\n');
  });
} else {
  test('automatic, manual and no-phase programs render the same tree and props as main', async () => {
    const main = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Record<string, string>;
    for (const kind of kinds) {
      setup({ phaseMode: kind, pending: kind === 'manual' });
      assert.equal(await renderScreen(), main[kind || 'none'], `program kind "${kind || 'none'}"`);
    }
    // The snapshot is a real screen: the list, the phase line and the preparing notice are in it.
    assert.match(main.manual!, /Today&#x27;s exercises/);
    assert.match(main.manual!, /Preparing your workout/);
    assert.match(main.automatic!, /Accumulation · Session 1/);
  });

  test('an AI program: one Start in every state, and its link only where it can be used', async () => {
    const cases: [string, Setup, string, string | null][] = [
      ['ordinary day', { phaseMode: 'ai_dynamic', prescription: plan() }, 'Start workout', 'Deload today instead'],
      [
        'prescribed deload',
        {
          phaseMode: 'ai_dynamic',
          prescription: plan({ deload: true, phaseAction: 'deload_recommended' }),
          preparation: { deload: true },
        },
        'Start deload',
        'Train full instead',
      ],
      ['no plan', { phaseMode: 'ai_dynamic' }, 'Start workout', 'Deload today instead'],
      [
        'workout under way',
        {
          phaseMode: 'ai_dynamic',
          prescription: plan(),
          workouts: [{ status: 'active', sessionId: 's1', sessionName: 'Push', intensityMode: 'full' }],
        },
        'Resume workout',
        null,
      ],
    ];
    for (const [name, s, start, link] of cases) {
      setup(s);
      const footer = footerOf(await renderScreen());
      const found = buttons(footer);
      const expected = link ? [start, link] : [start];
      assert.deepEqual(
        found.map((b) => b.label),
        expected,
        name,
      );
      // The link is the ghost button under Start; Start is the screen's own card.
      if (link) {
        assert.match(found[1]!.attrs, /data-variant="ghost"/, name);
      }
      assert.equal(footer.match(/data-ui="StartWorkoutCard"/g)?.length, 1, name);
    }
  });

  test('a deload that is still loading keeps the full card and shows the link busy; a failed one says so', async () => {
    setup({ phaseMode: 'ai_dynamic', prescription: plan(), preparation: { deloadLoading: true } });
    let html = await renderScreen();
    const footer = buttons(footerOf(html));
    assert.deepEqual(footer.map((b) => b.label), ['Start workout', 'Deload today instead']);
    assert.match(footer[1]!.attrs, /data-busy="true"/);
    assert.match(footer[1]!.attrs, /data-disabled="true"/);
    assert.match(html, /Today&#x27;s plan · Accumulation · Session 1/);
    setup({
      phaseMode: 'ai_dynamic',
      prescription: plan(),
      preparation: { deloadFailure: 'Could not load the deload. You are on the full plan.' },
    });
    html = await renderScreen();
    assert.match(html, /Could not load the deload\. You are on the full plan\./);
    assert.deepEqual(buttons(footerOf(html)).map((b) => b.label), ['Start workout', 'Deload today instead']);
  });

  test('a prescribed deload whose rows cannot be restored offers no Train full', async () => {
    const light = [lift('a', { deloaded: true }), lift('b', { deloaded: true })];
    setup({
      phaseMode: 'ai_dynamic',
      exercises: light,
      prescription: plan({ deload: true, phaseAction: 'deload_recommended', phase: 'deload' }),
      preparation: { deload: true },
    });
    const html = await renderScreen();
    assert.deepEqual(buttons(footerOf(html)).map((b) => b.label), ['Start deload']);
    assert.match(html, /Full numbers are not available for this plan yet/);
  });

  test('the phase is said once on an AI program, in the card; other programs keep it in the subtitle', async () => {
    setup({ phaseMode: 'ai_dynamic', prescription: plan() });
    const ai = await renderScreen();
    assert.doesNotMatch(ai.match(/data-ui="WorkoutLayout"[^>]*/)![0], /detail|Accumulation/);
    assert.ok(ai.includes('&quot;header&quot;:&quot;Today&#x27;s plan · Accumulation · Session 1&quot;'));
    setup({ phaseMode: 'automatic' });
    assert.match((await renderScreen()).match(/data-ui="WorkoutLayout"[^>]*/)![0], /Accumulation/);
  });

  test('the preparing notice is in the AI card, not a notice under it', async () => {
    setup({ phaseMode: 'ai_dynamic', pending: true });
    const html = await renderScreen();
    assert.doesNotMatch(html, /data-ui="Notice"[^>]*>Preparing your workout/);
    assert.match(html, /numbers may change in a moment/);
  });

  test('the plan card renders a lift note whole, with no line cap, and the buttons it should', async () => {
    const note = '−7.5% load: effort ran high while your 1RM slipped, so today starts lighter than planned and works back up.';
    const model = planStartModel({
      aiDynamic: true,
      sessionId: 's1',
      sessionName: 'Push',
      isBaseline: false,
      exercises: exercises as never,
      asSent: exercises as never,
      durationMinutes: 60,
      phaseDetail: 'Accumulation · Session 1',
      preparing: false,
      prescription: plan({ exercises: [{ sessionExerciseId: 'a', autoregNote: note }] }),
      prescriptionStatus: 'auto_applied',
      deloadChosen: false,
      active: null,
      units: {},
    })!;
    const Card = await loadCard();
    const html = render(Card as never, { model, onSelect() {} });
    assert.ok(html.includes(note), 'the note is drawn in full');
    assert.doesNotMatch(html, /data-lines/, 'no line cap anywhere in the card');
    assert.match(html, /Today&#x27;s plan · Accumulation · Session 1/);
    assert.deepEqual(labels(html), ['+ 1 more']);
  });
}
