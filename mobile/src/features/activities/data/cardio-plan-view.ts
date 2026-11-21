import type { z } from 'zod';
import { shiftDateStr } from '@trainingai/shared/date-utils';
import { cardioPlanKind } from '@trainingai/shared/running/cardio-goals';
import type { ActiveMinuteBasis } from '@trainingai/shared/running/walking-minutes';
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
  steps: Bar;
  minutes: Bar;
  days: WalkDayCircle[];
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

function weekDates(from: string, to: string): string[] {
  const start = from.replace(/\//g, '-');
  const out = [start];
  while (out[out.length - 1] < to.replace(/\//g, '-') && out.length < 7) {
    out.push(shiftDateStr(start, out.length));
  }
  return out;
}

const BASIS_NOTE: Record<ActiveMinuteBasis, string | null> = {
  heart_rate: null,
  cadence: 'Active minutes were counted from your cadence, because heart rate was thin.',
  speed: 'Active minutes were counted from your pace, because heart rate was thin.',
  estimated:
    'Active minutes are estimated, because heart rate was thin and there was no cadence or pace.',
};

/** What the week card shows. Every figure is the server's; this only lays them out. */
export function walkingWeekModel(walking: WalkingBlock): WalkingWeekModel {
  const { targets, week } = walking;
  const steps = week.stepsToday ?? 0;
  return {
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
    days: weekDates(week.from, week.to).map((date) => {
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
