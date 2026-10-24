import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import { bodyBatteryBand, type BodyBatteryLabel } from '@trainingai/shared/health/body-battery-band';
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

export type WidgetScore = {
  label: string;
  value: string | null;
  /** The chip's colour in each theme; a widget follows the phone's dark or light mode. */
  color: { dark: string; light: string };
  qualified: boolean;
};
export type WidgetBattery = {
  /** "64" and "Good · Charging": the level, label and trend Home's Body Battery card shows. */
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
export type WidgetNutrition = {
  /** "1,240" and "kcal left"; null without a calorie goal. */
  kcal: { value: string; label: string } | null;
  macros: WidgetMacro[];
  water: { text: string; goal: string | null; fraction: number | null };
};
export type WidgetSnapshot = {
  v: typeof WIDGET_SNAPSHOT_VERSION;
  /** The user's local date the snapshot describes. */
  date: string;
  updated: string;
  today: { scores: WidgetScore[]; battery: WidgetBattery | null };
  next: WidgetNext | null;
  nutrition: WidgetNutrition | null;
};

export type SnapshotInput = {
  date: string;
  now: Date;
  timezone: string;
  /** Null until the readiness scores have loaded. */
  scores: readonly ScoreChipModel[] | null;
  battery: Parameters<typeof batterySummary>[0];
  recommendation: RecommendationModel;
  energy: EnergyModel | null;
  water: { ml: number | null; goalMl: number } | null;
};

export function widgetSnapshot(input: SnapshotInput): WidgetSnapshot {
  return {
    v: WIDGET_SNAPSHOT_VERSION,
    date: input.date,
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
    nutrition: input.energy && input.water ? nutrition(input.energy, input.water) : null,
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

function battery(data: SnapshotInput['battery']): WidgetBattery | null {
  if (!data?.hasData || typeof data.current !== 'number' || !Number.isFinite(data.current)) return null;
  const summary = batterySummary(data);
  return {
    value: summary.value ?? '—',
    label: [summary.levelLabel, summary.trendLabel].filter(Boolean).join(' · '),
    level: Math.max(0, Math.min(100, Math.round(data.current))),
    band: bodyBatteryBand(data.label as BodyBatteryLabel),
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
        restDay: false,
      };
    case 'rest':
      return { eyebrow: 'Rest Day', name: 'Rest Day', meta: model.reason, sessionId: null, restDay: true };
    case 'checkin':
      return {
        eyebrow: 'Exercise Readiness',
        name: 'How are you feeling?',
        meta: 'Log Readiness · ~15 sec',
        sessionId: null,
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

function nutrition(energy: EnergyModel, water: { ml: number | null; goalMl: number }): WidgetNutrition {
  return {
    kcal: energy.remaining == null ? null : remainingText(energy.remaining),
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
      text: waterText(water.ml) ?? '—',
      goal: waterGoalText(water.goalMl),
      fraction: water.ml != null && water.goalMl > 0 ? Math.min(1, water.ml / water.goalMl) : null,
    },
  };
}
