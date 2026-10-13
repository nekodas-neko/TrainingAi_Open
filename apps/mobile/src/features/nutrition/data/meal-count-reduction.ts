export interface Pin {
  key: string;
  name: string;
  kind: 'saved' | 'typed';
}
export interface ReductionDecision {
  maxKeepable: number;
  preselected: string[];
  overflow: Pin[];
}
export function reductionNeeded(pins: Pin[], mealCount: number): ReductionDecision | null {
  const maxKeepable = Math.max(0, mealCount - 1);
  if (pins.length <= maxKeepable) return null;
  return {
    maxKeepable,
    preselected: pins.slice(0, maxKeepable).map((p) => p.key),
    overflow: pins.slice(maxKeepable),
  };
}
export function applyReduction<
  T extends {
    text: string;
    keep: boolean;
  },
>(
  keptKeys: string[],
  selectedIds: string[],
  typedMeals: T[],
): {
  selectedIds: string[];
  typedMeals: T[];
} {
  const kept = new Set(keptKeys);
  return {
    selectedIds: selectedIds.filter((id) => kept.has(id)),
    typedMeals: typedMeals.map((m) =>
      m.keep && !kept.has(m.text) ? { ...m, keep: false } : m,
    ),
  };
}
