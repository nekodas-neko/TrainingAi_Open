// Chart.js paints on a <canvas>, whose fillStyle/strokeStyle cannot resolve CSS
// custom properties — a `var(--x)` color silently falls back to black. Resolve it
// to the concrete computed value at paint time instead. Client-only (typeof window
// guard) since chart components using this can still render once during SSR.
export function resolveColor(color: string): string {
  if (color.startsWith("var(") && typeof window !== "undefined") {
    const name = color.slice(4, -1).split(",")[0].trim();
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (resolved) return resolved;
  }
  return color;
}
