import type { ActivityType } from './models';

// The one way to start an activity from the Cardio Hub (#4100). The sheet has a few steps; what
// each offers and what a tap does is here, so the screen only draws it and the order is testable.
export type StartStep = 'root' | 'walk-run' | 'treadmill' | 'else';
export type WalkRunKind = 'run' | 'walk' | 'guided' | 'treadmill';
export type TreadmillKind = 'walk' | 'run';

export const START_ROOT_ROWS: readonly {
  key: 'walk-run' | 'else';
  title: string;
  caption: string;
}[] = [
  { key: 'walk-run', title: 'Walk or run', caption: 'Run, walk, guided walk or treadmill' },
  { key: 'else', title: 'Something else', caption: 'Cycle, swim, anything you log' },
];
export const WALK_RUN_ROWS: readonly { key: WalkRunKind; title: string; caption: string }[] = [
  { key: 'run', title: 'Run', caption: 'Start a free run' },
  { key: 'walk', title: 'Walk', caption: 'Start a free walk' },
  { key: 'guided', title: 'Guided walk', caption: 'Fast and easy intervals' },
  { key: 'treadmill', title: 'Treadmill', caption: 'Record it live, or log it after' },
];
export const TREADMILL_KINDS: readonly { value: TreadmillKind; label: string }[] = [
  { value: 'walk', label: 'Walk' },
  { value: 'run', label: 'Run' },
];
export const TREADMILL_LOG_MINUTES = [20, 30, 45] as const;

export function startStepTitle(step: StartStep): string {
  return step === 'root'
    ? 'Start an activity'
    : step === 'walk-run'
      ? 'Walk or run'
      : step === 'treadmill'
        ? 'Treadmill'
        : 'Something else';
}
/** Where Back goes from a step; null from the first, where it closes the sheet. */
export function startStepBack(step: StartStep): StartStep | null {
  return step === 'root' ? null : step === 'treadmill' ? 'walk-run' : 'root';
}

export const RUN_TYPE: ActivityType = {
  id: 'run',
  label: 'Run',
  icon: 'PersonSimpleRun',
  isDistanceBased: true,
};
export const WALK_TYPE: ActivityType = {
  id: 'walk',
  label: 'Walk',
  icon: 'PersonSimpleWalk',
  isDistanceBased: true,
};
/** A treadmill walk or run: one `treadmill` type, so it records and syncs as it always has. */
export function treadmillType(kind: TreadmillKind): ActivityType {
  return kind === 'run'
    ? { id: 'treadmill', label: 'Treadmill run', icon: 'PersonSimpleRun', isDistanceBased: false }
    : { id: 'treadmill', label: 'Treadmill walk', icon: 'PersonSimpleWalk', isDistanceBased: false };
}

// "Something else" is the Log Activity grid minus what has its own place in Walk or run.
const OWN_PLACE = new Set(['treadmill', 'walk', 'run']);
export function somethingElseTypes<T extends { id: string }>(types: readonly T[]): T[] {
  return types.filter((type) => !OWN_PLACE.has(type.id.toLowerCase()));
}

/** What a start control does: with an activity open it says so, whatever was asked. */
export function startOutcome<T>(hasSession: boolean, start: T): 'in-progress' | T {
  return hasSession ? 'in-progress' : start;
}
/** The card's button: an open activity is named instead of offering a second start. */
export function startButtonTitle(hasSession: boolean): string {
  return hasSession ? 'Activity in progress' : 'Start an activity';
}
