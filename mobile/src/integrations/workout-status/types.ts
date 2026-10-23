export type Subscription = { remove(): void };

/** What the ongoing notification shows; Kotlin's WorkoutStatus reads these same keys. */
export type WorkoutStatusPayload = {
  /** The journal's workout id: what a tap returns to. */
  workoutId: string;
  sessionName: string;
  /** The exercise on screen, or the session's name in the warm-up and the review. */
  exerciseName: string;
  /** "ready" is between sets with no timer. "paused" is reserved: the journal has no pause yet. */
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
  /** The workout a tap on the notification started the app for, once; null otherwise. */
  takeOpenRequest(): string | null;
  addListener(event: 'onOpen', listener: (event: { workoutId: string }) => void): Subscription;
};
