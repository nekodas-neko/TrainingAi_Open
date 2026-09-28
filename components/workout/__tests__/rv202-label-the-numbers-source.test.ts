import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cachedNumbersSource, numbersSourceLabel } from '@/components/workout/numbers-source';
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

  // Today's payload is the one state that must stay unlabelled: a permanent note beside
  // "Recommended workout" would be furniture, and the lifter would stop reading it on the day
  // it meant something.
  it('says nothing when there is nothing to say', () => {
    expect(numbersSourceLabel(null)).toBeNull();
    expect(numbersSourceLabel(undefined)).toBeNull();
  });
});

describe('cachedNumbersSource — RV-202 ③ trigger', () => {
  it('labels a payload built on an earlier day', () => {
    expect(cachedNumbersSource({ dataDate: '2026-09-26' }, false))
      .toEqual({ kind: 'cached', date: '2026-09-26' });
  });

  it('does not label today', () => {
    expect(cachedNumbersSource({ dataDate: '2026-09-27' }, true)).toBeNull();
  });

  // `isWorkoutDataToday` treats a dataDate-less payload as NOT today, which is right for the
  // `loggedTodayInSession` strip it was written for and wrong as a label trigger: there is no day
  // to name. Silence beats a guessed date.
  it('stays silent on a payload with no dataDate rather than inventing one', () => {
    expect(cachedNumbersSource({}, false)).toBeNull();
    expect(cachedNumbersSource(null, false)).toBeNull();
    expect(cachedNumbersSource(undefined, false)).toBeNull();
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
