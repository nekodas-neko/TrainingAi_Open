import { shiftDateStr } from '@trainingai/shared/date-utils';

// The four scores at the top of Home: which value each shows and what it is called. Home's chips
// and the home-screen widget both read this, so the two never word or pick a score differently.

type Readiness = {
  readinessDisplayScore?: number | null;
  sleepScore?: number | null;
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
  /** Shown instead of the rounded value: the night's hours when there is no sleep score. */
  display?: string;
  /** What the figure counts when it is not a score: the heart chip is a bpm reading. */
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
  const night = sleep.find((row) => row.date === today || row.date === shiftDateStr(today, -1));
  const duration = data?.sleepScore == null ? night?.durationHours : null;
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
      label: duration != null ? 'Sleep (h)' : 'Sleep',
      shortLabel: 'Sleep',
      value: data?.sleepScore ?? null,
      ...(duration != null ? { display: duration.toFixed(1) } : {}),
      qualified: Boolean(
        sleep.find((row) => row.date === today)?.provisional ||
          (data?.sleepScoreCoverage != null && data.sleepScoreCoverage.level !== 'full'),
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
