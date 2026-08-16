const COMMIT_PX = 60;
const FLICK_VELOCITY = 0.5; // px/ms
const EDGE_RESISTANCE = 0.2;

/** Dampen drag beyond the first/last panel. */
export function applyEdgeResistance(dx: number, index: number, count: number): number {
  const atEdge = (index === 0 && dx > 0) || (index === count - 1 && dx < 0);
  return atEdge ? dx * EDGE_RESISTANCE : dx;
}

/** Decide the landing index from drag distance + flick velocity. */
export function commitTarget(dx: number, index: number, velocity: number, count: number): number {
  const commit = Math.abs(dx) > COMMIT_PX || (Math.abs(velocity) > FLICK_VELOCITY && Math.abs(dx) > 10);
  if (!commit) return index;
  const next = dx < 0 ? index + 1 : index - 1;
  return Math.min(count - 1, Math.max(0, next));
}
