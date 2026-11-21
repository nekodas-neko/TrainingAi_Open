import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  initialNavigation,
  openOnTab,
  pop,
  push,
  replaceTop,
  selectTab,
  top,
  type Navigation,
  type Route,
} from '../src/app/navigation/stack.ts';
import {
  advance,
  drawn,
  finish,
  idle,
  layerLook,
  layerOfEntry,
  layerOfTab,
  layerOrder,
  startValues,
  touchable,
  type Motion,
} from '../src/app/navigation/transition.ts';

// #3758. Which layers slide or fade when the navigation changes, and what stays drawn while they do.

const on = (tab: Navigation['tab']) => selectTab(initialNavigation, tab);
const walk = (nav: Navigation, ...routes: Route[]) => routes.reduce(push, nav);
const roles = (motion: Motion) =>
  Object.fromEntries(Object.entries(motion.parts).map(([id, part]) => [id, part.role]));
const entryLayer = (nav: Navigation) => layerOfEntry(top(nav)!);

test('opening a screen slides it in over the layer below, which holds still', () => {
  const from = on('Workout');
  const to = push(from, { screen: 'cardio' });
  const motion = advance(idle, from, to, false);
  assert.deepEqual(roles(motion), {
    [entryLayer(to)]: 'slide-in',
    [layerOfTab('Workout')]: 'under',
  });
});

test('opening over a screen holds that screen under the slide', () => {
  const from = walk(on('Workout'), { screen: 'cardio' });
  const to = push(from, { screen: 'running' });
  assert.deepEqual(roles(advance(idle, from, to, false)), {
    [entryLayer(to)]: 'slide-in',
    [entryLayer(from)]: 'under',
  });
});

test('Back slides the top screen out and keeps it drawn until it has gone', () => {
  const from = walk(on('Workout'), { screen: 'cardio' }, { screen: 'running' });
  const to = pop(from);
  const motion = advance(idle, from, to, false);
  assert.deepEqual(roles(motion), {
    [entryLayer(from)]: 'slide-out',
    [entryLayer(to)]: 'under',
  });
  assert.deepEqual(
    motion.leaving.map((entry) => entry.screen),
    ['running'],
  );
  // The stack no longer holds it, yet it is still drawn.
  assert.deepEqual(
    drawn(to, motion).map((entry) => entry.screen),
    ['cardio', 'running'],
  );
  const ended = finish(motion, entryLayer(from));
  assert.deepEqual(ended, { ...idle, seq: motion.seq });
  assert.deepEqual(
    drawn(to, ended).map((entry) => entry.screen),
    ['cardio'],
  );
});

test('Back from the only screen slides it out over the tab', () => {
  const from = walk(on('More'), { screen: 'more-about' });
  const motion = advance(idle, from, pop(from), false);
  assert.deepEqual(roles(motion), {
    [entryLayer(from)]: 'slide-out',
    [layerOfTab('More')]: 'under',
  });
});

test('switching tabs cross-fades and nothing slides', () => {
  const from = on('Home');
  const motion = advance(idle, from, selectTab(from, 'Health'), false);
  assert.deepEqual(roles(motion), {
    [layerOfTab('Home')]: 'fade-out',
    [layerOfTab('Health')]: 'fade-in',
  });
  assert.deepEqual(motion.leaving, []);
});

test('choosing a tab while a screen is open fades the screen out with it still drawn', () => {
  const from = walk(on('Workout'), { screen: 'cardio' });
  const motion = advance(idle, from, selectTab(from, 'Health'), false);
  assert.deepEqual(roles(motion), {
    [entryLayer(from)]: 'fade-out',
    [layerOfTab('Health')]: 'fade-in',
  });
  assert.deepEqual(
    motion.leaving.map((entry) => entry.screen),
    ['cardio'],
  );
});

test('a screen opened on another tab, and a screen that replaces another, fade rather than slide', () => {
  const home = on('Home');
  const onWorkout = openOnTab(home, 'Workout', {
    screen: 'workout-session',
    sessionId: 's',
    fullOverride: false,
  });
  assert.equal(roles(advance(idle, home, onWorkout, false))[entryLayer(onWorkout)], 'fade-in');
  const session = walk(on('Workout'), {
    screen: 'workout-session',
    sessionId: 's',
    fullOverride: false,
  });
  const log = replaceTop(session, { screen: 'workout-log', workoutId: 'w' });
  assert.equal(roles(advance(idle, session, log, false))[entryLayer(log)], 'fade-in');
});

test('returning to an earlier screen through push closes the screens above it, once', () => {
  const from = walk(
    on('Workout'),
    { screen: 'cardio' },
    { screen: 'running' },
    { screen: 'activity-recording' },
  );
  const to = push(from, { screen: 'cardio' });
  const motion = advance(idle, from, to, false);
  assert.equal(roles(motion)[entryLayer(from)], 'slide-out');
  // The one in the middle is dropped at once, not slid.
  assert.deepEqual(
    motion.leaving.map((entry) => entry.screen),
    ['activity-recording'],
  );
});

test('Remove animations: nothing moves and nothing is held', () => {
  const from = walk(on('Workout'), { screen: 'cardio' });
  assert.equal(advance(idle, from, pop(from), true), idle);
  assert.equal(advance(idle, on('Home'), on('Health'), true), idle);
  // Turned on mid-way: whatever was moving is released.
  const moving = advance(idle, from, pop(from), false);
  assert.equal(advance(moving, pop(from), from, true), idle);
});

test('Back during an open slides the same screen out, from where it is', () => {
  const base = on('Workout');
  const opened = push(base, { screen: 'cardio' });
  const opening = advance(idle, base, opened, false);
  const closing = advance(opening, opened, pop(opened), false);
  const id = entryLayer(opened);
  assert.equal(closing.parts[id].role, 'slide-out');
  assert.notEqual(
    closing.parts[id],
    opening.parts[id],
    'a new part, so the layer starts a new motion',
  );
  assert.equal(closing.parts[layerOfTab('Workout')].role, 'under');
  assert.deepEqual(
    closing.leaving.map((entry) => entry.screen),
    ['cardio'],
  );
});

test('opening a second screen during an open leaves the first one finishing its slide', () => {
  const base = on('Workout');
  const first = push(base, { screen: 'cardio' });
  const second = push(first, { screen: 'running' });
  const opening = advance(idle, base, first, false);
  const next = advance(opening, first, second, false);
  assert.equal(
    next.parts[entryLayer(first)],
    opening.parts[entryLayer(first)],
    'still its own slide-in',
  );
  assert.equal(next.parts[entryLayer(second)].role, 'slide-in');
  assert.equal(next.parts[layerOfTab('Workout')].role, 'under');
  // The first, landed, is held under the second; the tab it covers is no longer drawn.
  const afterFirst = finish(next, entryLayer(first));
  assert.equal(afterFirst.parts[entryLayer(first)].role, 'under');
  const afterBoth = finish(afterFirst, entryLayer(second));
  assert.deepEqual(afterBoth.parts, {});
});

test('two Backs in a row: each screen slides out, and each is released as it lands', () => {
  const from = walk(on('Workout'), { screen: 'cardio' }, { screen: 'running' });
  const one = pop(from);
  const two = pop(one);
  const first = advance(idle, from, one, false);
  const second = advance(first, one, two, false);
  assert.deepEqual(
    second.leaving.map((entry) => entry.screen),
    ['running', 'cardio'],
  );
  const landed = finish(second, entryLayer(from));
  assert.deepEqual(
    landed.leaving.map((entry) => entry.screen),
    ['cardio'],
  );
  assert.deepEqual(
    drawn(two, landed).map((entry) => entry.screen),
    ['cardio'],
  );
  assert.deepEqual(finish(landed, entryLayer(one)).parts, {});
});

test('a change that does not move the top layer changes nothing', () => {
  const nav = walk(on('Workout'), { screen: 'cardio' });
  assert.equal(advance(idle, nav, nav, false), idle);
  assert.equal(advance(idle, nav, { ...nav }, false), idle);
});

test('finishing a layer that was not moving changes nothing', () => {
  const moving = advance(idle, on('Home'), on('More'), false);
  assert.equal(finish(moving, 'entry:99'), moving);
});

test('the Coach is one layer per scope, however many times it is opened', () => {
  const a = walk(on('Home'), { screen: 'coach', scope: 'general' });
  const b = pop(a);
  const c = push(b, { screen: 'coach', scope: 'general' });
  assert.equal(layerOfEntry(top(a)!), 'coach:general');
  assert.equal(layerOfEntry(top(c)!), 'coach:general');
  assert.equal(roles(advance(idle, b, c, false))['coach:general'], 'slide-in');
});

// Review of #3995.

const session = { screen: 'workout-session', sessionId: 's', fullOverride: false } as const;
const coach = { screen: 'coach', scope: 'general' } as const;
const z = (nav: Navigation, motion: Motion) =>
  new Proxy(layerOrder(nav, motion), { get: (order, id: string) => order[id] ?? 0 });

test('the Coach is drawn above the session it opens over, and keeps that place sliding out', () => {
  const home = on('Home');
  const withSession = walk(home, session);
  const withCoach = push(withSession, coach);
  const opening = advance(idle, withSession, withCoach, false);
  const order = z(withCoach, opening);
  assert.ok(order['coach:general'] > order[entryLayer(withSession)]);
  assert.ok(order[entryLayer(withSession)] > order[layerOfTab('Home')]);
  const closing = advance(idle, withCoach, withSession, false);
  const back = z(withSession, closing);
  assert.ok(back['coach:general'] > back[entryLayer(withSession)], 'still above while it leaves');
});

test('a screen opened over the Coach is above it, and Back from it keeps it above', () => {
  const nav = walk(on('Home'), coach, { screen: 'programs' });
  const order = z(nav, advance(idle, pop(nav), nav, false));
  assert.ok(order[entryLayer(nav)] > order['coach:general']);
  const back = z(pop(nav), advance(idle, nav, pop(nav), false));
  assert.ok(back[layerOfEntry(top(nav)!)] > back['coach:general']);
});

test('two screens leaving at once are drawn in stack order, over the tab', () => {
  const from = walk(on('Workout'), { screen: 'cardio' }, { screen: 'running' });
  const one = pop(from);
  const two = pop(one);
  const motion = advance(advance(idle, from, one, false), one, two, false);
  const order = z(two, motion);
  const [cardio, running] = from.stack;
  assert.ok(order[layerOfEntry(running)] > order[layerOfEntry(cardio)]);
  assert.ok(order[layerOfEntry(cardio)] > order[layerOfTab('Workout')]);
});

test('a layer that finishes while a screen still slides over it stays drawn under that screen', () => {
  const base = on('Workout');
  const first = push(base, { screen: 'cardio' });
  const second = push(first, { screen: 'running' });
  const next = advance(advance(idle, base, first, false), first, second, false);
  const landed = finish(next, entryLayer(first));
  assert.deepEqual(roles(landed), {
    [entryLayer(second)]: 'slide-in',
    [entryLayer(first)]: 'under',
  });
  assert.equal(
    landed.parts[layerOfTab('Workout')],
    undefined,
    'the tab is covered by the screen now, so it is not drawn through it',
  );
  assert.deepEqual(finish(landed, entryLayer(second)).parts, {});
});

test('an entering layer starts at its first position, so its first frame is not at rest', () => {
  assert.deepEqual(startValues('slide-in', true), { slide: 0, fade: 1 });
  assert.deepEqual(startValues('fade-in', true), { slide: 1, fade: 0 });
  assert.deepEqual(startValues('slide-out', true), { slide: 1, fade: 1 });
  assert.deepEqual(startValues('fade-out', true), { slide: 1, fade: 1 });
  // Already moving: carry on from where it is.
  for (const role of ['slide-in', 'slide-out', 'fade-in', 'fade-out'] as const) {
    assert.deepEqual(startValues(role, false), {});
  }
  assert.deepEqual(startValues('under', true), {});
});

test('a layer fading out keeps the slide it had, instead of snapping to rest', () => {
  assert.equal(layerLook('fade-out', false).slide, true);
  assert.equal(layerLook('fade-in', false).slide, true);
  assert.equal(layerLook('fade-out', false).fade, true);
  assert.deepEqual(layerLook('slide-in', false), { slide: true, fade: false, clip: false });
  assert.deepEqual(layerLook(undefined, false), { slide: false, fade: false, clip: false });
  assert.equal(layerLook('under', true).clip, true);
});

test('a tab chosen during an open fades the half-slid screen out from where it is', () => {
  const base = on('Workout');
  const opened = push(base, { screen: 'cardio' });
  const opening = advance(idle, base, opened, false);
  const switched = advance(opening, opened, selectTab(opened, 'Health'), false);
  assert.equal(switched.parts[entryLayer(opened)].role, 'fade-out');
  assert.equal(layerLook('fade-out', false).slide, true);
});

test('the newly active screen is not touchable while the screen above it slides out', () => {
  const from = walk(on('Workout'), { screen: 'cardio' });
  const to = pop(from);
  const motion = advance(idle, from, to, false);
  assert.equal(touchable(true, motion.parts[layerOfTab('Workout')]), false);
  const landed = finish(motion, entryLayer(from));
  assert.equal(touchable(true, landed.parts[layerOfTab('Workout')]), true);
  // Never touchable when it is not the active layer.
  assert.equal(touchable(false, undefined), false);
  // Remove animations: no part at all, so no delay.
  assert.equal(touchable(true, advance(idle, from, to, true).parts[layerOfTab('Workout')]), true);
});

test('whatever was opened and closed, once every motion has ended the top layer is touchable', () => {
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const routes: Route[] = [{ screen: 'cardio' }, { screen: 'running' }, { screen: 'programs' }, coach];
  const tabs = ['Home', 'Health', 'Workout', 'Nutrition', 'More'] as const;
  for (let run = 0; run < 200; run += 1) {
    let nav = on('Home');
    let motion = idle;
    for (let step = 0; step < 8; step += 1) {
      const next = [
        () => push(nav, routes[rand(routes.length)]),
        () => pop(nav),
        () => selectTab(nav, tabs[rand(tabs.length)]),
        () => replaceTop(nav, routes[rand(routes.length)]),
      ][rand(4)]();
      motion = advance(motion, nav, next, false);
      nav = next;
      if (rand(3) === 0) {
        for (const id of Object.keys(motion.parts)) {
          if (motion.parts[id]) motion = finish(motion, id);
        }
      }
    }
    for (const id of [...Object.keys(motion.parts), ...motion.leaving.map(layerOfEntry)]) {
      motion = finish(motion, id);
    }
    const entry = top(nav);
    const id = entry ? layerOfEntry(entry) : layerOfTab(nav.tab);
    assert.deepEqual(motion.parts, {}, 'nothing is held when nothing moves');
    assert.equal(touchable(true, motion.parts[id]), true);
  }
});
