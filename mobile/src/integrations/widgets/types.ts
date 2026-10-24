export type HomeWidgets = {
  /** Stores the snapshot the home-screen widgets draw from (features/widgets/snapshot.ts). */
  writeSnapshot(json: string): void;
};
