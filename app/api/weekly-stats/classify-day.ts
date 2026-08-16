import type { WorkoutSession } from "@trainingai/shared/types/log";

export function isDeloadSession(ws: WorkoutSession): boolean {
  return ws.isEarlyDeload || ws.phaseType === 'deload' || ws.phaseType === 'testing';
}

export function isTestingSession(ws: WorkoutSession): boolean {
  return ws.phaseType === 'testing';
}

function sessionVolume(ws: WorkoutSession): number {
  return ws.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0);
}

export interface DayClassification {
  /** Volume that counts toward the week's headline total. Excludes deload and testing. */
  volume: number;
  /**
   * Volume from the sessions `volume` holds out. Kept separate so it can't inflate the weekly
   * total, but is still available to draw the day's bar at a real height — a deload day is
   * training, not a rest day (Q-246).
   */
  deloadVolume: number;
  isDeload: boolean;
  isTesting: boolean;
}

export function classifyDay(daySessions: WorkoutSession[]): DayClassification {
  const volume = daySessions.filter(ws => !isDeloadSession(ws)).reduce((s, ws) => s + sessionVolume(ws), 0);
  const deloadVolume = daySessions.filter(ws => isDeloadSession(ws)).reduce((s, ws) => s + sessionVolume(ws), 0);
  // `isDeloadSession` is true for testing sessions too, so `every(isDeloadSession)` used to label a
  // pure testing day "D". Decide testing first and let it win, so each day gets its own marker.
  const isTesting = daySessions.some(ws => isTestingSession(ws));
  const isDeload = !isTesting && daySessions.length > 0 && daySessions.every(ws => isDeloadSession(ws));
  return { volume, deloadVolume, isDeload, isTesting };
}
