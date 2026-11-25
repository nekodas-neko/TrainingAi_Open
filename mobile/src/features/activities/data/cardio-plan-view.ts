import type { z } from 'zod';
import { shiftDateStr } from '@trainingai/shared/date-utils';
import { STEPS_DAYS_TO_MEET_WEEK } from '@trainingai/shared/running/walking-plan';
import { cardioPlanKind } from '@trainingai/shared/running/cardio-goals';
import type { ActiveMinuteBasis } from '@trainingai/shared/running/walking-minutes';
import type { Tone } from '../../../shared/theme/theme';
import type { runningPlanSpec } from './models';

type PlanPayload = z.infer<ReturnType<typeof runningPlanSpec>['schema']>;
export type WalkingBlock = NonNullable<PlanPayload['walking']>;

/**
 * Which Cardio screens a plan payload gets (#3779): no plan asks which kind first, a walking plan
 * gets the walking week, a running plan keeps the screens it has. The plan's kind is the shared
 * `cardioPlanKind`, never a string compare here.
 */
export type CardioPlanMode = 'choice' | 'walking' | 'running';
export function cardioPlanMode(plan: PlanPayload['plan'] | undefined): CardioPlanMode {
  if (!plan) return 'choice';
  return cardioPlanKind({ goalKind: plan.goalKind ?? '', frameworkKey: plan.frameworkKey }) ===
    'walking'
    ? 'walking'
    : 'running';
}

/** The two tiles of the "walk or run" choice, and the button that follows the pick. */
export type PlanChoice = 'walking' | 'running';
export const PLAN_CHOICE_TILES: readonly {
  key: PlanChoice;
  title: string;
  caption: string;
}[] = [
  {
    key: 'walking',
    title: 'Walking and heart health',
    caption: 'Your steps and active minutes each week. No running.',
  },
  {
    key: 'running',
    title: 'Running',
    caption: 'Build your pace or distance, like a lifting program for runs.',
  },
];
export const PLAN_CHOICE_EYEBROW = 'What do you want from cardio?';
export const PLAN_CHOICE_NOTE = 'You can switch at any time. Your history is kept for both.';
export function planChoiceButton(choice: PlanChoice): string {
  return choice === 'walking' ? 'Start walking plan' : 'Choose a running goal';
}

export type WalkDayState = 'done' | 'part' | 'empty' | 'left-out';
export interface WalkDayCircle {
  date: string;
  letter: string;
  state: WalkDayState;
  today: boolean;
}
export interface Bar {
  /** The large number. */
  figure: string;
  caption: string;
  /** 0 to 1, for the progress bar. */
  value: number;
  complete: boolean;
}
export interface WalkingWeekModel {
  /** The week's status chip (rule B, from the server); null hides it. */
  status: { label: string; tone: Tone } | null;
  steps: Bar;
  minutes: Bar;
  days: WalkDayCircle[];
  /** What the day circles mean, one line under them. */
  daysCaption: string;
  /** Which half of the week is behind, said only when the badge says Behind. */
  behindLine: string | null;
  /** Which rule counted the week's minutes, said only when it was not heart rate. */
  basisNote: string | null;
}
export interface WalkingTodayModel {
  headline: string;
  detail: string;
  done: boolean;
}

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
function commas(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function ratio(value: number, target: number): number {
  return target > 0 ? Math.min(1, Math.max(0, value / target)) : 0;
}
/** A calendar date's weekday letter. The date is already the person's local day, so this is calendar arithmetic only. */
export function dayLetter(date: string): string {
  const [y, m, d] = date.replace(/\//g, '-').split('-').map(Number);
  return LETTERS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** A walking plan has its own step target and shows today and the week; the profile-goal quota card would be a second one. */
export function showStepsQuotaCard(walking: WalkingBlock | null | undefined): boolean {
  return !walking;
}

/** The week's seven dates, Monday first, whether or not they have happened. */
export function weekDates(from: string): string[] {
  const start = from.replace(/\//g, '-');
  return Array.from({ length: 7 }, (_, i) => shiftDateStr(start, i));
}

const BASIS_NOTE: Record<ActiveMinuteBasis, string | null> = {
  heart_rate: null,
  cadence: 'Active minutes were counted from your cadence, because heart rate was thin.',
  speed: 'Active minutes were counted from your pace, because heart rate was thin.',
  estimated:
    'Active minutes are estimated, because heart rate was thin and there was no cadence or pace.',
};

const STATUS_TONE: Record<string, Tone> = { met: 'activity', on_track: 'brand', behind: 'checkin' };
/** The chip comes only from the server's `status`; a key this build does not know is drawn neutral. */
export function walkingStatusChip(walking: WalkingBlock): WalkingWeekModel['status'] {
  const status = walking.week.status;
  return status ? { label: status.label, tone: STATUS_TONE[status.key] ?? 'neutral' } : null;
}

/**
 * Under a "Behind" badge: which target is out of reach. Display only; the badge itself is the
 * server's rule (`walkingWeekStatus`) and this repeats its two fit tests to name the half that
 * failed. A day with no row on or before today is before the plan began, so it is not counted.
 */
export function walkingBehindLine(walking: WalkingBlock): string | null {
  const { week, targets } = walking;
  if (week.status?.key !== 'behind') return null;
  const today = week.days.find((day) => day.isToday)?.date.replace(/\//g, '-') ?? week.to.replace(/\//g, '-');
  const rows = new Map(week.days.map((day) => [day.date.replace(/\//g, '-'), day]));
  const counted = weekDates(week.from).filter((date) => {
    const row = rows.get(date);
    return date > today ? true : !!row && !row.excluded;
  });
  const left = counted.filter((date) => date >= today);
  const needed = Math.min(STEPS_DAYS_TO_MEET_WEEK, counted.length);
  const stepDaysMet = counted.filter((date) => rows.get(date)?.stepsMet).length;
  const chances = left.filter((date) => date > today || !rows.get(date)?.stepsMet).length;
  const minutes = counted.reduce((sum, date) => sum + (rows.get(date)?.activeMinutes ?? 0), 0);
  const parts: string[] = [];
  if (stepDaysMet + chances < needed) parts.push(`${stepDaysMet} of ${needed} step days`);
  if (targets.activeMinutesPerWeek - minutes > left.length * targets.activeMinutesPerDay) {
    parts.push(`${commas(minutes)} of ${commas(targets.activeMinutesPerWeek)} active minutes`);
  }
  if (!parts.length) return null;
  return `${parts.join(' and ')} so far; ${left.length} ${left.length === 1 ? 'day' : 'days'} left`;
}

/** What the week card shows. Every figure is the server's; this only lays them out. */
export function walkingWeekModel(walking: WalkingBlock): WalkingWeekModel {
  const { targets, week } = walking;
  const steps = week.stepsToday ?? 0;
  return {
    status: walkingStatusChip(walking),
    steps: {
      figure: commas(steps),
      caption: `of ${commas(targets.stepsPerDay)} steps today`,
      value: ratio(steps, targets.stepsPerDay),
      complete: steps >= targets.stepsPerDay,
    },
    minutes: {
      figure: commas(week.activeMinutes),
      caption: `of ${commas(targets.activeMinutesPerWeek)} active minutes this week`,
      value: ratio(week.activeMinutes, targets.activeMinutesPerWeek),
      complete: week.activeMinutes >= targets.activeMinutesPerWeek,
    },
    // Seven circles, Monday to Sunday: the payload holds only the days it measured (none before the
    // plan began), so the rest of the week is drawn empty rather than left out of the row.
    days: weekDates(week.from).map((date) => {
      const day = week.days.find((row) => row.date.replace(/\//g, '-') === date);
      return {
        date,
        letter: dayLetter(date),
        today: !!day?.isToday,
        state: !day
          ? 'empty'
          : day.excluded
            ? 'left-out'
            : day.done
              ? 'done'
              : (day.steps ?? 0) > 0 || day.activeMinutes > 0
                ? 'part'
                : 'empty',
      } as WalkDayCircle;
    }),
    daysCaption: 'A tick is a day you hit your steps or your minutes.',
    behindLine: walkingBehindLine(walking),
    basisNote: week.activeMinutesBasis ? BASIS_NOTE[week.activeMinutesBasis] : null,
  };
}

/** The Today card: what finishes the day, in plain words. */
export function walkingTodayModel(walking: WalkingBlock): WalkingTodayModel {
  const today = walking.week.days.find((day) => day.isToday);
  if (today?.excluded) {
    return {
      headline: today.excluded === 'sick' ? 'Today is left out: you are unwell' : 'Today is a rest day',
      detail: 'It does not count for or against your week.',
      done: false,
    };
  }
  if (today?.done) {
    return {
      headline: 'Today is done',
      detail: 'Your steps or your active minutes are in. Anything more is a bonus.',
      done: true,
    };
  }
  const left = Math.max(0, walking.targets.stepsPerDay - (walking.week.stepsToday ?? 0));
  return {
    headline: `A ${walking.targets.activeMinutesPerDay} minute brisk walk finishes today`,
    detail: `${commas(left)} steps to go. Any walk counts, recorded or not.`,
    done: false,
  };
}
