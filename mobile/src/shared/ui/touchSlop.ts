/**
 * The `hitSlop` that brings a control drawn `drawn` dp high (or wide) up to the touch target
 * without moving it: half the shortfall on each side, never negative.
 */
export function slopTo(target: number, drawn: number) {
  return Math.max(0, Math.ceil((target - drawn) / 2));
}

/**
 * The `top` that centres a `slot` dp tall overlay on a line `line` dp tall, so a 48 px status slot
 * can sit over a header line without adding height to the row (negative when the slot is taller).
 */
export function centredOverlayTop(line: number, slot: number) {
  return (line - slot) / 2;
}
