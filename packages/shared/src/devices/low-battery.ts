// When a device's low-battery alert fires. The TypeScript twin of `DeviceBatteryNotifier.decide` in
// the Capacitor app, so TrainingAi Preview alerts at the same thresholds (#3066).
//
// Hysteresis is the point: a strap polled every few minutes would otherwise notify on every poll.
// The alert fires once on the way down and re-arms only after the battery genuinely recovers, or
// the device goes on charge.

/** Owner-chosen (2026-08-05): quiet above this, alert below. */
export const LOW_BATTERY_PERCENT = 35
/** Re-arm only at or above this, so a reading hovering on 35 cannot alternate armed and fired. */
export const LOW_BATTERY_REARM_PERCENT = 40

export interface LowBatteryDecision {
  notify: boolean
  /** Whether an alert for this device is now outstanding. Persist it and pass it back next time. */
  fired: boolean
}

export function decideLowBatteryAlert(percent: number, charging: boolean, alreadyFired: boolean): LowBatteryDecision {
  if (charging) return { notify: false, fired: false }
  if (percent < LOW_BATTERY_PERCENT) return { notify: !alreadyFired, fired: true }
  if (percent >= LOW_BATTERY_REARM_PERCENT) return { notify: false, fired: false }
  return { notify: false, fired: alreadyFired }
}
