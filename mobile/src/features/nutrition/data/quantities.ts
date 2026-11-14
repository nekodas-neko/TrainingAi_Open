export type QtyUnit = 'serving' | 'g';
const round2 = (n: number) => Math.round(n * 100) / 100;
const MAX_QTY = 100;
export function qtyFromInput(
  raw: string,
  unit: QtyUnit,
  servingSizeG: number | null | undefined,
): number | null {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const serving = servingSizeG ?? 0;
  if (unit === 'g' && serving <= 0) return null;
  return Math.min(MAX_QTY, round2(unit === 'g' ? n / serving : n));
}
export function ingredientAmountLabel(
  servingSizeG: number | null | undefined,
  qty: number,
): string {
  const serving = servingSizeG ?? 0;
  if (serving > 0) return `${Math.round(serving * qty)} g`;
  const servings = round2(qty);
  return `${servings} ${servings === 1 ? 'serving' : 'servings'}`;
}
