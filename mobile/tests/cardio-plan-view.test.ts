import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cardioPlanMode,
  dayLetter,
  planChoiceButton,
  walkingTodayModel,
  walkingStatusChip,
  walkingWeekModel,
  walkingBehindLine,
  weekDates,
  showStepsQuotaCard,
  type WalkingBlock,
} from '../src/features/activities/data/cardio-plan-view.ts';

// #3779 — what each Cardio card shows for a given payload. Every figure here is the server's.
const week = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
function block(over: {
  steps?: (number | null)[];
  done?: boolean[];
  excluded?: ('rest' | 'sick' | null)[];
  minutes?: number;
  stepsToday?: number | null;
  basis?: 'heart_rate' | 'cadence' | 'speed' | 'estimated' | null;
  today?: number;
} = {}): WalkingBlock {
  return {
    targets: { stepsPerDay: 8000, activeMinutesPerWeek: 140, activeMinutesPerDay: 20 },
    week: {
      from: week[0],
      to: week[6],
      stepsToday: over.stepsToday === undefined ? 6240 : over.stepsToday,
      activeMinutes: over.minutes ?? 85,
      activeMinutesBasis: over.basis === undefined ? 'heart_rate' : over.basis,
      days: week.map((date, i) => ({
        date,
        steps: over.steps?.[i] ?? null,
        stepsMet: (over.steps?.[i] ?? 0) >= 8000,
        activeMinutes: 0,
        minutesMet: false,
        done: over.done?.[i] ?? false,
        excluded: over.excluded?.[i] ?? null,
        isToday: i === (over.today ?? 5),
      })),
    },
  } as WalkingBlock;
}

test('no plan asks which kind first; a walking plan and a running plan are told apart by the shared rule', () => {
  assert.equal(cardioPlanMode(null), 'choice');
  assert.equal(cardioPlanMode(undefined), 'choice');
  assert.equal(cardioPlanMode({ id: 'a', frameworkKey: 'walking-heart-health', goalKind: 'walking' }), 'walking');
  assert.equal(cardioPlanMode({ id: 'a', frameworkKey: 'zone2-base', goalKind: 'heart_health' }), 'running');
  assert.equal(cardioPlanMode({ id: 'a', frameworkKey: 'zone2-base' }), 'running');
});

test('the choice button follows the pick', () => {
  assert.equal(planChoiceButton('walking'), 'Start walking plan');
  assert.equal(planChoiceButton('running'), 'Choose a running goal');
});

test('mid-week: two bars from the payload and a circle per day, Monday to Sunday', () => {
  const m = walkingWeekModel(block({ steps: [9000, 8200, 3000, null, 0, 6240, null], done: [true, true, false, false, false, false, false] }));
  assert.equal(m.steps.figure, '6,240');
  assert.equal(m.steps.caption, 'of 8,000 steps today');
  assert.ok(Math.abs(m.steps.value - 0.78) < 1e-9);
  assert.equal(m.minutes.figure, '85');
  assert.equal(m.minutes.caption, 'of 140 active minutes this week');
  assert.equal(m.days.map((d) => d.letter).join(''), 'MTWTFSS');
  assert.deepEqual(m.days.map((d) => d.state), ['done', 'done', 'part', 'empty', 'empty', 'part', 'empty']);
  assert.deepEqual(m.days.map((d) => d.today), [false, false, false, false, false, true, false]);
  assert.equal(m.basisNote, null);
});

test('a day left out is not drawn as missed', () => {
  const m = walkingWeekModel(block({ excluded: ['rest'] }));
  assert.equal(m.days[0].state, 'left-out');
});

test('week target met fills the minutes bar', () => {
  const m = walkingWeekModel(block({ minutes: 155 }));
  assert.equal(m.minutes.value, 1);
  assert.equal(m.minutes.complete, true);
  assert.equal(m.steps.complete, false);
});

test('no step reading shows zero on the bar, not a crash', () => {
  const m = walkingWeekModel(block({ stepsToday: null }));
  assert.equal(m.steps.figure, '0');
  assert.equal(m.steps.value, 0);
});

test('minutes counted without dense heart rate say which rule was used', () => {
  assert.match(walkingWeekModel(block({ basis: 'cadence' })).basisNote ?? '', /cadence/);
  assert.match(walkingWeekModel(block({ basis: 'speed' })).basisNote ?? '', /pace/);
  assert.match(walkingWeekModel(block({ basis: 'estimated' })).basisNote ?? '', /estimated/);
});

test('today card: what finishes the day, and what is left', () => {
  const t = walkingTodayModel(block({ stepsToday: 6240 }));
  assert.equal(t.headline, 'A 20 minute brisk walk finishes today');
  assert.equal(t.detail, '1,760 steps to go. Any walk counts, recorded or not.');
  assert.equal(t.done, false);
});

test('today card: a done day and a left-out day', () => {
  const done = walkingTodayModel(block({ done: [false, false, false, false, false, true, false] }));
  assert.equal(done.done, true);
  assert.equal(done.headline, 'Today is done');
  const rest = walkingTodayModel(block({ excluded: [null, null, null, null, null, 'rest', null] }));
  assert.equal(rest.headline, 'Today is a rest day');
});

test('weekday letters come from the calendar date, with either separator', () => {
  assert.equal(dayLetter('2026-11-16'), 'M');
  assert.equal(dayLetter('2026/11/22'), 'S');
});

test('the status chip is the server\'s label with a theme tone, and is hidden when none is sent', () => {
  const withStatus = (status: unknown) => {
    const b = block();
    (b.week as { status?: unknown }).status = status;
    return b;
  };
  assert.deepEqual(walkingStatusChip(withStatus({ key: 'on_track', label: 'On track' })), { label: 'On track', tone: 'brand' });
  assert.deepEqual(walkingStatusChip(withStatus({ key: 'met', label: 'Week met' })), { label: 'Week met', tone: 'activity' });
  assert.deepEqual(walkingStatusChip(withStatus({ key: 'behind', label: 'Behind' })), { label: 'Behind', tone: 'checkin' });
  assert.deepEqual(walkingStatusChip(withStatus({ key: 'later', label: 'Later' })), { label: 'Later', tone: 'neutral' });
  assert.equal(walkingStatusChip(block()), null);
  assert.equal(walkingStatusChip(withStatus(null)), null);
  assert.equal(walkingWeekModel(block()).status, null);
});

// #4142: the payload holds only the days measured, Monday to today.
function partWeek(todayIdx: number, stepsMet: boolean[], minutesPerDay: number[], status = 'behind'): WalkingBlock {
  const b = block();
  b.week.to = week[todayIdx];
  b.week.status = { key: status, label: 'Behind' };
  b.week.days = week.slice(0, todayIdx + 1).map((date, i) => ({
    date,
    steps: stepsMet[i] ? 9000 : 1000,
    stepsMet: stepsMet[i],
    activeMinutes: minutesPerDay[i],
    minutesMet: false,
    done: false,
    excluded: null,
    isToday: i === todayIdx,
  })) as WalkingBlock['week']['days'];
  return b;
}

test('the week row is always seven dates, Monday to Sunday, even on a Wednesday', () => {
  assert.deepEqual(weekDates('2026-11-16'), week);
  assert.deepEqual(weekDates('2026/11/16'), week);
  const m = walkingWeekModel(partWeek(2, [true, false, false], [10, 10, 10]));
  assert.equal(m.days.length, 7);
  assert.equal(m.days.map((d) => d.letter).join(''), 'MTWTFSS');
  assert.deepEqual(m.days.slice(3).map((d) => d.state), ['empty', 'empty', 'empty', 'empty']);
  assert.match(m.daysCaption, /hit your steps or your minutes/);
});

test('the Behind line names the half that is out of reach: steps, minutes, or both', () => {
  // Saturday. Two step days met, two chances left (today, Sunday): 4 of 5 is out of reach. Minutes are fine.
  const steps = partWeek(5, [true, true, false, false, false, false], [30, 30, 30, 30, 30, 30]);
  assert.equal(walkingBehindLine(steps), '2 of 5 step days so far; 2 days left');
  // Four step days met so five is reachable; 20 of 140 minutes with 40 possible is not.
  const minutes = partWeek(5, [true, true, true, true, false, false], [5, 5, 5, 5, 0, 0]);
  assert.equal(walkingBehindLine(minutes), '20 of 140 active minutes so far; 2 days left');
  const both = partWeek(5, [true, true, false, false, false, false], [5, 5, 0, 0, 0, 0]);
  assert.equal(walkingBehindLine(both), '2 of 5 step days and 10 of 140 active minutes so far; 2 days left');
  // The model carries it, and a week that is not behind says nothing.
  assert.equal(walkingWeekModel(steps).behindLine, '2 of 5 step days so far; 2 days left');
  assert.equal(walkingBehindLine(partWeek(5, [true, true, false, false, false, false], [30, 30, 30, 30, 30, 30], 'on_track')), null);
  assert.equal(walkingBehindLine(block()), null);
});

test('under a walking plan the profile-goal steps card is not drawn, so one step target shows (#4142)', () => {
  assert.equal(showStepsQuotaCard(block()), false);
  assert.equal(showStepsQuotaCard(null), true);
  assert.equal(showStepsQuotaCard(undefined), true);
});
