import { currentSleepScore } from '@trainingai/shared/health/sleep-card-night';

// The four scores at the top of Home: which value each shows and what it is called. Home's chips
// and the home-screen widget both read this, so the two never word or pick a score differently.

type Readiness = {
  readinessDisplayScore?: number | null;
  sleepScore?: number | null;
  sleepScoreDate?: string | null;
  activityScore?: number | null;
  restingHr?: number | null;
  restingHrLastNight?: number | null;
  hrCurrent?: number | null;
  limited?: boolean | null;
  isLowWearToday?: boolean | null;
  sleepScoreCoverage?: { level: string } | null;
};
type Night = { date: string; durationHours?: number | null; provisional?: boolean | null };

export type ScoreKey = 'readiness' | 'heart' | 'sleep' | 'activity';
export type ScoreChipModel = {
  key: ScoreKey;
  label: string;
  /** The band styles' small-capital name ("Move" for Activity); scoreChipLabel picks which shows. */
  shortLabel: string;
  value: number | null;
  /** Shown instead of the rounded value. */
  display?: string;
  /** What the figure counts when it is not a score: bpm for the heart chip. */
  unit?: string;
  /** Drawn with Home's info mark: the score rests on limited data. */
  qualified: boolean;
};

export function homeScoreChips(
  data: Readiness | null | undefined,
  sleep: readonly Night[],
  today: string,
): ScoreChipModel[] {
  const resting = data?.restingHrLastNight != null || data?.restingHr != null;
  // #3667: the current app's chip, which this matches: last night's score or a dash. Never an older
  // night's score as today's, and never the hours in its place (a night marked partial has no score
  // by design, and its hours are the short reading the mark exists to stop).
  const sleepScore = currentSleepScore(data, today);
  return [
    {
      key: 'readiness',
      label: 'Readiness',
      shortLabel: 'Ready',
      value: data?.readinessDisplayScore ?? null,
      qualified: Boolean(data?.limited || data?.isLowWearToday),
    },
    {
      key: 'heart',
      label: resting ? 'Resting HR' : 'Heart Rate',
      shortLabel: resting ? 'Rest HR' : 'HR',
      value: data?.restingHrLastNight ?? data?.restingHr ?? data?.hrCurrent ?? null,
      unit: 'bpm',
      qualified: false,
    },
    {
      key: 'sleep',
      label: 'Sleep',
      shortLabel: 'Sleep',
      value: sleepScore,
      qualified: Boolean(
        sleep.find((row) => row.date === today)?.provisional ||
          (sleepScore != null && data?.sleepScoreCoverage != null && data.sleepScoreCoverage.level !== 'full'),
      ),
    },
    {
      key: 'activity',
      label: 'Activity',
      shortLabel: 'Move',
      value: data?.activityScore ?? null,
      qualified: false,
    },
  ];
}

/** The text a chip shows: ScoreChip's own rule, a dash for no value. */
export function chipText(chip: ScoreChipModel): string {
  return chip.display ?? (chip.value === null ? '—' : String(Math.round(chip.value)));
}

/** The text and unit a chip shows, in every layout: a figure that is not a score always has its unit. */
export function chipFigure(chip: ScoreChipModel): { text: string; unit?: string } {
  return chip.unit && (chip.value !== null || chip.display != null)
    ? { text: chipText(chip), unit: chip.unit }
    : { text: chipText(chip) };
}

/**
 * The pillars beside the Energy hero (#2989), in the one order every layout draws them: Sleep,
 * Heart, Activity. Readiness has no chip there; Energy opens at it.
 */
export function homePillars(
  data: Readiness | null | undefined,
  sleep: readonly Night[],
  today: string,
): ScoreChipModel[] {
  const [, heart, sleepChip, activity] = homeScoreChips(data, sleep, today);
  return [sleepChip!, heart!, activity!];
}
