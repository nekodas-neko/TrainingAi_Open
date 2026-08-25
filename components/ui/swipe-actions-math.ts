/** Width of one action button in the revealed tray, in px. */
export const ACTION_WIDTH = 64;
const FLICK_VELOCITY = 0.4; // px/ms
const RUBBER_BAND = 0.25;

/** Full tray width for `n` actions. */
export function trayWidth(count: number): number {
  return count * ACTION_WIDTH;
}

/**
 * Where the row sits mid-drag, given the raw horizontal movement.
 *
 * Negative is left (tray revealed). Dragging further than the tray, or dragging right from a
 * closed row, is damped rather than blocked — a hard stop reads as a broken gesture, and the
 * damping is what tells a thumb it has reached the end.
 */
export function dragOffset(mx: number, openAtStart: boolean, count: number): number {
  const width = trayWidth(count);
  const raw = openAtStart ? mx - width : mx;
  if (raw > 0) return raw * RUBBER_BAND;
  if (raw < -width) return -width + (raw + width) * RUBBER_BAND;
  return raw;
}

/**
 * Whether the row rests open after the thumb lifts.
 *
 * A flick commits in its own direction regardless of distance; otherwise the row lands wherever
 * it is closest to. `velocity` is unsigned (that is what `@use-gesture` reports), so direction
 * comes from `direction`, which is -1 travelling left.
 */
export function shouldRestOpen(
  offset: number, velocity: number, direction: number, count: number,
): boolean {
  if (velocity > FLICK_VELOCITY && direction !== 0) return direction < 0;
  return offset < -trayWidth(count) / 2;
}
