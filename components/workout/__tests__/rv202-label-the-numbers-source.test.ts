import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { payloadNumbersSource, numbersSourceLabel } from '@/components/workout/numbers-source';
import { stripComments } from '../../../scripts/lib/strip-comments.js';

const read = (p: string) =>
  stripComments(readFileSync(path.join(process.cwd(), p), 'utf8'));

describe('numbersSourceLabel — RV-202 ③ wording', () => {
  // `26 Sept`, not `26 September` — `formatDayShort`'s own doc example is `6 July`, a month with
  // no abbreviation, so the shortening is invisible there. Measured rather than assumed.
  it('names the day a cached payload was built', () => {
    expect(numbersSourceLabel({ kind: 'cached', date: '2026-09-26' })).toBe('From 26 Sept');
    expect(numbersSourceLabel({ kind: 'cached', date: '2026-07-06' })).toBe('From 6 July');
  });

  it('names the program when the numbers came from the on-device mirror', () => {
    expect(numbersSourceLabel({ kind: 'base' })).toBe('Base program');
  });

  // #2110: today's plan, built from the program because the model could not be reached.
  it('names the program when today\'s plan is a rules plan', () => {
    expect(numbersSourceLabel({ kind: 'rules' })).toBe('From your program');
  });

  // Today's payload is the one state that must stay unlabelled: a permanent note beside
  // "Recommended workout" would be furniture, and the lifter would stop reading it on the day
  // it meant something.
  it('says nothing when there is nothing to say', () => {
    expect(numbersSourceLabel(null)).toBeNull();
    expect(numbersSourceLabel(undefined)).toBeNull();
  });
});

describe('payloadNumbersSource — RV-202 ③ trigger', () => {
  it('labels a payload built on an earlier day', () => {
    expect(payloadNumbersSource({ dataDate: '2026-09-26' }, false))
      .toEqual({ kind: 'cached', date: '2026-09-26' });
  });

  it('does not label today', () => {
    expect(payloadNumbersSource({ dataDate: '2026-09-27' }, true)).toBeNull();
  });

  // `isWorkoutDataToday` treats a dataDate-less payload as NOT today, which is right for the
  // `loggedTodayInSession` strip it was written for and wrong as a label trigger: there is no day
  // to name. Silence beats a guessed date.
  it('stays silent on a payload with no dataDate rather than inventing one', () => {
    expect(payloadNumbersSource({}, false)).toBeNull();
    expect(payloadNumbersSource(null, false)).toBeNull();
    expect(payloadNumbersSource(undefined, false)).toBeNull();
  });
});

describe('payloadNumbersSource — a rules plan (#2110)', () => {
  it('labels today\'s payload when its prescription is a rules plan', () => {
    expect(payloadNumbersSource({ dataDate: '2026-10-06', prescriptionSource: 'rules' }, true))
      .toEqual({ kind: 'rules' });
  });

  // A coached plan is the normal case, and a plan stored before `source` existed carries none.
  it('stays silent for a model plan or an unmarked one', () => {
    expect(payloadNumbersSource({ dataDate: '2026-10-06', prescriptionSource: 'model' }, true)).toBeNull();
    expect(payloadNumbersSource({ dataDate: '2026-10-06' }, true)).toBeNull();
  });

  // An earlier day is the fact that can mislead more, and that day's rules plan may already have
  // been replaced by a coached one.
  it('names the earlier day rather than the rules plan on a stale payload', () => {
    expect(payloadNumbersSource({ dataDate: '2026-10-05', prescriptionSource: 'rules' }, false))
      .toEqual({ kind: 'cached', date: '2026-10-05' });
  });
});

describe('the label is wired to every paint source — RV-202 ③', () => {
  const screen = read('components/workout-screen.tsx');
  const pre = read('components/workout/pre-workout-screen.tsx');

  // Every path that REPLACES the list has to answer for where those numbers came from. One that
  // sets `exercises` and not this leaves the previous path's label on screen — worse than no
  // label, because it is then wrong rather than absent.
  //
  // Counted as whole-list replacements only: the two `setExercises(prev => …)` updaters edit a
  // list already painted and change nothing about its provenance. The two cache seeds share one
  // `paintSeed` body, so three replacement sites cover the four paint sources.
  it('sets the source everywhere the list is replaced', () => {
    const replacements = (screen.match(/setExercises\((?!prev)/g) ?? []).length;
    const sources = (screen.match(/setNumbersSource\(/g) ?? []).length;
    expect(replacements, 'the paint paths moved — re-read them before changing this number').toBe(3);
    expect(sources, 'a path replaces the list without saying where it came from').toBe(replacements);
  });

  it('passes it to the pre-workout screen', () => {
    expect(screen).toMatch(/numbersSource=\{numbersSource\}/);
    expect(pre).toMatch(/numbersSource\s*=\s*null,/);
  });

  // The heading already swaps to "Preparing your AI workout…" while a fresh plan generates, and
  // two provenance claims on one line read as neither. The label therefore lives inside the
  // not-pending branch.
  it('renders the label only in the non-pending branch of the heading', () => {
    const heading = pre.slice(pre.indexOf('Preparing your AI workout'));
    const label = heading.indexOf('{sourceLabel &&');
    const recommended = heading.indexOf('Recommended workout');
    expect(label, 'the label must render in the heading block').toBeGreaterThan(-1);
    expect(label, 'the label belongs after "Recommended workout", not beside the spinner')
      .toBeGreaterThan(recommended);
  });

  // RV-209 gave the type scale a floor at 11 px. A new label is exactly where a `text-[10px]`
  // gets written, so pin it: this one is on the scale.
  it('does not introduce a sub-floor font size', () => {
    const block = pre.slice(pre.indexOf('{sourceLabel &&'), pre.indexOf('{sourceLabel &&') + 400);
    expect(block).not.toMatch(/text-\[\d+(\.\d+)?px\]/);
  });
});
