import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import { bodyBatteryBand } from '@trainingai/shared/health/body-battery-band';
import { energyHero, type BodyBatteryEnergyInput } from '@trainingai/shared/health/body-battery-energy';
import { scoreColors } from '../../shared/theme/tokens.ts';
import { chipText, type ScoreChipModel } from '../home/data/score-chips.ts';
import type { RecommendationModel } from '../home/data/recommendation-model.ts';
import { remainingText, type EnergyModel } from '../nutrition/data/energy-model.ts';
import { waterGoalText, waterText } from '../health/data/body-view.ts';
import { batterySummary } from '../health/data/battery-summary.ts';

// What the home-screen widgets will draw: one snapshot built only from what the app already holds,
// every value formatted here, so a widget never calls the server or works anything out itself.
// Bump `v` with any change a widget's parser must know about. Nothing in it is ever logged.

export const WIDGET_SNAPSHOT_VERSION = 1;
/** One tap of the widget's water button. The drain validates it again (validWaterMlDeltaOrNull). */
export const WIDGET_WATER_TAP_ML = 250;
/** Taps the widget can show before the app next runs; a ninth tap shows the eighth's row. */
export const WIDGET_WATER_MAX_STEPS = 8;

export type WidgetScore = {
  label: string;
  value: string | null;
  /** The chip's colour in each theme; a widget follows the phone's dark or light mode. */
  color: { dark: string; light: string };
  qualified: boolean;
};
export type WidgetBattery = {
  /** "64" and "Good · Charging": Home's Energy hero level and label (energyHero), with the live trend. */
  value: string;
  label: string;
  /** 0–100, for the bar. */
  level: number;
  band: 'drained' | 'low' | 'good';
};
export type WidgetNext = {
  eyebrow: string;
  name: string;
  meta: string;
  /** Opens this session; null for the check-in and rest-day cards. */
  sessionId: string | null;
  /** Home offers "Start Workout" here: not for a workout in progress, a finished one or a rest day. */
  startable: boolean;
  restDay: boolean;
};
export type WidgetMacro = {
  key: 'protein' | 'carbs' | 'fat';
  label: string;
  /** "62 g left", "12 g over"; null without a target. */
  left: string | null;
  /** Eaten over target, 0–1; null without a target. */
  fraction: number | null;
};
/** The water row as it reads after some number of +250 ml taps the app has not seen yet. */
export type WidgetWaterStep = { text: string; fraction: number | null };
export type WidgetNutrition = {
  /** "1,240" and "kcal left"; null without a calorie goal. */
  kcal: { value: string; label: string } | null;
  macros: WidgetMacro[];
  water: {
    text: string;
    goal: string | null;
    fraction: number | null;
    /** The widget's +250 ml button adds this many ml per tap. */
    tapMl: number;
    /**
     * The row after 0, 1, 2 … taps, worded here so the widget can redraw at once when the app is
     * closed without working out a litre or a fraction itself. steps[0] is text and fraction.
     */
    steps: WidgetWaterStep[];
  };
};
export type WidgetSnapshot = {
  v: typeof WIDGET_SNAPSHOT_VERSION;
  /** The signed-in account it was built for; a widget refuses a snapshot for anyone else. */
  user: string;
  /** The user's local date the snapshot describes. */
  date: string;
  /** The profile's IANA zone that date is in; a widget judges "today" and midnight in it, not in the phone's zone. */
  tz: string;
  updated: string;
  today: { scores: WidgetScore[]; battery: WidgetBattery | null };
  next: WidgetNext | null;
  nutrition: WidgetNutrition | null;
};

export type SnapshotInput = {
  user: string;
  date: string;
  now: Date;
  timezone: string;
  /** Null until the readiness scores have loaded. */
  scores: readonly ScoreChipModel[] | null;
  battery: ((BodyBatteryEnergyInput & Parameters<typeof batterySummary>[0]) | null) | undefined;
  recommendation: RecommendationModel;
  /** The macro targets and what has been eaten (nutritionEnergyModel). */
  energy: EnergyModel | null;
  /** "kcal left" as Home's nutrition card counts it: the energy balance's budget alone (budgetEnergyModel). */
  budget: EnergyModel | null;
  water: { ml: number | null; goalMl: number } | null;
};

export function widgetSnapshot(input: SnapshotInput): WidgetSnapshot {
  return {
    v: WIDGET_SNAPSHOT_VERSION,
    user: input.user,
    date: input.date,
    tz: input.timezone,
    updated: `Updated ${formatTimeOfDay(input.now, input.timezone)}`,
    today: {
      scores: (input.scores ?? []).map((chip) => ({
        label: chip.label,
        value: chip.value === null && chip.display == null ? null : chipText(chip),
        color: { dark: scoreColors.dark[chip.key], light: scoreColors.light[chip.key] },
        qualified: chip.qualified,
      })),
      battery: battery(input.battery),
    },
    next: next(input.recommendation),
    nutrition: input.energy && input.water ? nutrition(input.energy, input.budget, input.water) : null,
  };
}

/** Whether a snapshot has anything to draw; an empty one never replaces the last, dated one. */
export function hasContent(snapshot: WidgetSnapshot): boolean {
  return snapshot.today.scores.length > 0 || snapshot.next !== null;
}

/** Everything but the time, so the same numbers a minute later are not written again. */
export function snapshotIdentity(snapshot: WidgetSnapshot): string {
  return JSON.stringify({ ...snapshot, updated: undefined });
}

/** The figure and band are Home's Energy hero's own (energyHero), so the widget follows its rule. */
function battery(data: SnapshotInput['battery']): WidgetBattery | null {
  const hero = energyHero(data);
  if (!data || !hero.hasData) return null;
  const trend = batterySummary(data).trendLabel;
  return {
    value: String(hero.level),
    label: [hero.label, trend].filter(Boolean).join(' · '),
    level: hero.level,
    band: bodyBatteryBand(hero.label),
  };
}

function next(model: RecommendationModel): WidgetNext | null {
  switch (model.kind) {
    case 'session':
      return {
        eyebrow: model.eyebrow,
        name: model.name,
        meta: model.facts.map((fact) => fact.text).join(' · '),
        sessionId: model.session.id,
        startable: model.action === 'start' || model.action === 'deload',
        restDay: false,
      };
    case 'rest':
      return { eyebrow: 'Rest Day', name: 'Rest Day', meta: model.reason, sessionId: null, startable: false, restDay: true };
    case 'checkin':
      return {
        eyebrow: 'Exercise Readiness',
        name: 'How are you feeling?',
        meta: 'Log Readiness · ~15 sec',
        sessionId: null,
        startable: false,
        restDay: false,
      };
    default:
      return null;
  }
}

const MACROS = [
  { key: 'protein', label: 'Protein', field: 'proteinG' },
  { key: 'carbs', label: 'Carbs', field: 'carbsG' },
  { key: 'fat', label: 'Fat', field: 'fatG' },
] as const;

function nutrition(
  energy: EnergyModel,
  budget: EnergyModel | null,
  water: { ml: number | null; goalMl: number },
): WidgetNutrition {
  const step = (ml: number | null): WidgetWaterStep => ({
    text: waterText(ml) ?? '—',
    fraction: ml != null && water.goalMl > 0 ? Math.min(1, ml / water.goalMl) : null,
  });
  const steps = Array.from({ length: WIDGET_WATER_MAX_STEPS + 1 }, (_, taps) =>
    step(taps === 0 ? water.ml : (water.ml ?? 0) + taps * WIDGET_WATER_TAP_ML),
  );
  return {
    kcal: budget?.remaining == null ? null : remainingText(budget.remaining),
    macros: MACROS.map(({ key, label, field }) => {
      const target = energy.targets[field];
      const eaten = energy.total?.[field] ?? 0;
      if (target == null || target <= 0) return { key, label, left: null, fraction: null };
      const left = Math.round(target - eaten);
      return {
        key,
        label,
        left: left < 0 ? `${-left} g over` : `${left} g left`,
        fraction: Math.min(1, eaten / target),
      };
    }),
    water: {
      text: steps[0]!.text,
      goal: waterGoalText(water.goalMl),
      fraction: steps[0]!.fraction,
      tapMl: WIDGET_WATER_TAP_ML,
      steps,
    },
  };
}
