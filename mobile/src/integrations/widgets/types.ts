export type HomeWidgets = {
  /** Stores the snapshot the home-screen widgets draw from (features/widgets/snapshot.ts). */
  writeSnapshot(json: string): void;
  /** Removes the snapshot and any queued widget taps, so no widget can show a signed-out account's numbers. */
  clearSnapshot(): void;
  /**
   * The +250 ml taps made on the home screen that the app has not recorded yet, as a JSON array of
   * { id, ml, at, date, user } (features/widgets/pending-water.ts).
   */
  peekPending(): string;
  /** Removes recorded taps by id. Ids that are not queued are ignored. */
  ackPending(ids: string[]): void;
  /** Where a widget tap asked the app to go ("next-session:12"), once; null when it did not. */
  takeLaunchTarget(): string | null;
};
