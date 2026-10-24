export type HomeWidgets = {
  /** Stores the snapshot the home-screen widgets draw from (features/widgets/snapshot.ts). */
  writeSnapshot(json: string): void;
  /** Removes the snapshot, so no widget can draw a signed-out account's numbers. */
  clearSnapshot(): void;
};
