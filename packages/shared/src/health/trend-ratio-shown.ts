// A trend ratio as the AI prescription prompt shows it (#3718). The prompt prints each ratio with
// two decimals, and its rest rule ("spo2_trend < 0.97") is applied by the model to that printed
// number, so 0.9671 reaches it as "0.97" and does not fire. The daily check compares the same
// two-decimal value, taken from this one function, so the two cannot drift apart inside the
// rounding band. `toFixed` and `Math.round` differ on some halves, which is why both sides use this.

/** The ratio as the prompt prints it. */
export function formatTrendRatio(ratio: number): string {
  return ratio.toFixed(2)
}

/** The number the AI is shown, back as a number, for the daily check's comparison. */
export function shownTrendRatio(ratio: number): number {
  return Number(formatTrendRatio(ratio))
}
