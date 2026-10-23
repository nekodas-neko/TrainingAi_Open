export type HomeWidgets = {
  /** Stores the snapshot the widgets draw and redraws every placed widget from it. */
  setSnapshot(json: string): void;
  /** How many Today widgets are on the home screen. */
  installedCount(): number;
};
