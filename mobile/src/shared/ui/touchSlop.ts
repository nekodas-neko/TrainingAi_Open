/**
 * The `hitSlop` that brings a control drawn `drawn` dp high (or wide) up to the touch target
 * without moving it: half the shortfall on each side, never negative.
 */
export function slopTo(target: number, drawn: number) {
  return Math.max(0, Math.ceil((target - drawn) / 2));
}
