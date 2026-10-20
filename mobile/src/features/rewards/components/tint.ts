/** `color` at `fraction` opacity. Theme colours are #rrggbb; anything else is returned as it is. */
export function tint(color: string, fraction: number) {
  return /^#[\da-f]{6}$/i.test(color)
    ? `${color}${Math.round(Math.min(1, Math.max(0, fraction)) * 255)
        .toString(16)
        .padStart(2, '0')}`
    : color;
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * `color` at `fraction` laid over `base`, as one opaque colour: the current app's
 * `color-mix(in oklab, colour 12%, var(--color-background))`. A tile that also glows must be opaque,
 * because Android draws the glow as elevation, and a see-through tile shows that shadow as a dark
 * box behind its icon and name. Anything that is not #rrggbb is returned as `color`.
 */
export function blend(color: string, base: string, fraction: number) {
  if (!/^#[\da-f]{6}$/i.test(color) || !/^#[\da-f]{6}$/i.test(base)) return color;
  const f = Math.min(1, Math.max(0, fraction));
  const [c, b] = [channels(color), channels(base)];
  return `#${c
    .map((v, i) =>
      Math.round(v * f + b[i] * (1 - f))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
