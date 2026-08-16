// The one place the protein/carbs/fat palette lives — import everywhere a
// macro needs a colour instead of redefining the trio (or a divergent scheme).
export const MACRO_COLORS = {
  protein: "#22c55e",
  carbs: "#3b82f6",
  fat: "#f97316",
} as const;
