import {
  RUN_TYPE,
  WALK_TYPE,
  startOutcome,
  treadmillType,
  type StartStep,
  type TreadmillKind,
} from './cardio-start';
import type { ActivityType } from './models';

// What every start control on the Cardio Hub does (#4100). The screen draws the controls and
// supplies the effects; the rule is here once: with an activity open a control names it and starts
// nothing, otherwise it starts, and the sheet it sits in closes before the screen navigates (#4099).
export type StartDeps = {
  /** An activity is already open. */
  hasSession: boolean;
  /** Start this type, through the screen's single locked start. */
  select(type: ActivityType): void;
  /** Record a finished treadmill session of this length, then open it. */
  recordTreadmill(minutes: number, kind: TreadmillKind): void;
  openWalk(): void;
  openRunning(): void;
  /** Open the Start sheet at this step. */
  openStart(step: StartStep): void;
  /** The in-progress notice, with Resume and Discard. */
  showInProgress(): void;
  /** Runs `next` once the sheet that was open has closed. */
  afterSheet(next: () => void): void;
};

/**
 * The controls of one surface. `closeSheet` closes the sheet they sit in; a control on the page
 * itself has none and acts at once.
 */
export function startActions(deps: StartDeps, closeSheet?: () => void) {
  const go = (next: () => void) => {
    if (!closeSheet) return next();
    deps.afterSheet(next);
    closeSheet();
  };
  // Every control goes through here, so none can start something with an activity open.
  const guarded =
    <A extends unknown[]>(start: (...args: A) => void) =>
    (...args: A) => {
      const outcome = startOutcome(deps.hasSession, () => start(...args));
      if (outcome === 'in-progress') go(deps.showInProgress);
      else outcome();
    };
  return {
    kind: guarded((kind: 'run' | 'walk' | 'guided') => {
      if (kind === 'guided') return go(deps.openWalk);
      deps.select(kind === 'run' ? RUN_TYPE : WALK_TYPE);
    }),
    treadmillNow: guarded((kind: TreadmillKind) => deps.select(treadmillType(kind))),
    treadmillLog: guarded((kind: TreadmillKind, minutes: number) =>
      deps.recordTreadmill(minutes, kind),
    ),
    type: guarded((type: ActivityType) => deps.select(type)),
    // The running plan's own screen (the time picker's Run).
    runningPlan: guarded(() => go(deps.openRunning)),
    // The one Start sheet, at a step: the time picker's Log activity, the walking card's Treadmill
    // and Other.
    startSheet: guarded((step: StartStep) => go(() => deps.openStart(step))),
  };
}
