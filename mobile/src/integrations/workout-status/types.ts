export type Subscription = { remove(): void };

/** What the ongoing notification shows; Kotlin's WorkoutStatus reads these same keys. */
export type WorkoutStatusPayload = {
  /** The journal's workout id: what a tap returns to. */
  workoutId: string;
  sessionName: string;
  /** The exercise on screen, or the session's name in the warm-up and the review. */
  exerciseName: string;
  /** "ready" is between sets with no timer. "paused" is a pause the workout is held in (#3255). */
  phase: 'working' | 'resting' | 'ready' | 'paused';
  /** The set in progress or next, 1-based; 0 when there is none to name. */
  nextSet: number;
  sets: number;
  /** Only what the plan or the logger knows: "80 kg × 8", "80 kg", "8 reps", or null. */
  load: string | null;
  restEndsAt: number | null;
  /** Shown when there is no set to name: "Warm-up", "Exercise done". */
  label: string | null;
  /** When the workout began; a workout open for more than six hours posts nothing. */
  startedAt: number;
  // The rest is read by picture-in-picture (#3266), which draws from this same payload.
  /** When the running set started; null outside a set or when the set has no start. */
  setStartedAt: number | null;
  /** When the current rest began, or the last set ended where no rest is timed. */
  restStartedAt: number | null;
  /** Sets recorded so far in this exercise. */
  setsDone: number;
  /** The exercise Next moves to, from the exercise summary; null when Next ends the workout. */
  nextUp: string | null;
  /** When the current pause began; null unless `phase` is "paused". */
  pausedAt: number | null;
  // #3734: where the lifter is in the session, and the clock when nothing else runs.
  /** The exercise's place among the session's, 1-based, and how many there are; 0 with none. */
  exerciseIndex: number;
  exerciseCount: number;
  /** `startedAt` moved on by the pauses already ended: now minus this is the workout's time. */
  workoutFrom: number;
  /** The exercise Next moves to: its place, set count and first set's load; 0 / null with none. */
  nextUpIndex: number;
  nextUpSets: number;
  nextUpLoad: string | null;
  /**
   * #3745, the window's copy alone, like `hr`: the answer buttons are offered until `until`, and
   * `answer` is the one the question stands on. Null when the window doesn't ask.
   */
  effortAsk: { until: number; answer: -1 | 0 | 1 } | null;
  /** The app's accent as `#rrggbb` for the always-dark window; the window's copy alone. */
  accent: string | null;
  /**
   * The strap's latest reading, for the window only: the notification never reads it, and
   * `workoutStatusFor` leaves it null so a reading every second is not a status change.
   */
  hr: { bpm: number; zoneName: string | null; zoneColor: string | null; at: number } | null;
};

/** What the system did with the notification, read back from it (Kotlin's promotionReport). */
export type PromotionReport = {
  posted: boolean;
  promoted: boolean;
  /** Build.VERSION.SDK_INT_FULL: 3600000 is Android 16, 3600001 is 16 QPR2; 0 below Android 16. */
  sdkFull: number;
  canPostPromoted: boolean;
};

export type WorkoutStatusModule = {
  /** True when the notification was posted; false when notifications are off or it was dismissed. */
  show(status: WorkoutStatusPayload): boolean;
  update(status: WorkoutStatusPayload): boolean;
  clear(): void;
  promotion(): PromotionReport;
  /**
   * The workout a tap on the notification started the app for, once; null otherwise. `resume` is
   * set when the tap was on the paused notification's Resume button.
   */
  takeOpenRequest(): { workoutId: string; resume: boolean } | null;
  addListener(
    event: 'onOpen',
    listener: (event: { workoutId: string; resume: boolean }) => void,
  ): Subscription;
};
