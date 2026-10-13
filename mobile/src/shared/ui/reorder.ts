export type ItemBounds = { y: number; height: number };
export function moveItem(order: readonly string[], id: string, target: string): string[] {
  const from = order.indexOf(id);
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
export function dragOrder(
  order: readonly string[],
  bounds: ReadonlyMap<string, ItemBounds>,
  id: string,
  dy: number,
): string[] {
  const start = bounds.get(id);
  if (!start) return [...order];
  const centre = start.y + start.height / 2 + dy;
  let target = id;
  let distance = Math.abs(dy);
  for (const key of order) {
    const row = bounds.get(key);
    if (!row || key === id) continue;
    const difference = Math.abs(row.y + row.height / 2 - centre);
    if (difference < distance) {
      target = key;
      distance = difference;
    }
  }
  return moveItem(order, id, target);
}
export function displacedItems(
  order: readonly string[],
  next: readonly string[],
  bounds: ReadonlyMap<string, ItemBounds>,
  gap: number,
): Map<string, number> {
  const shifts = new Map<string, number>();
  let y = bounds.get(order[0])?.y ?? 0;
  for (const key of next) {
    const row = bounds.get(key);
    if (!row) continue;
    shifts.set(key, y - row.y);
    y += row.height + gap;
  }
  return shifts;
}

export function preserveHiddenOrder(all: readonly string[], visible: readonly string[]): string[] {
  const movable = new Set(visible);
  let index = 0;
  return all.map((id) => (movable.has(id) ? visible[index++] : id));
}

export function reorderBounds(
  order: readonly string[],
  next: readonly string[],
  bounds: ReadonlyMap<string, ItemBounds>,
  gap: number,
): Map<string, ItemBounds> {
  const settled = new Map(bounds);
  for (const [id, shift] of displacedItems(order, next, bounds, gap)) {
    const layout = bounds.get(id);
    if (layout) settled.set(id, { ...layout, y: layout.y + shift });
  }
  return settled;
}
