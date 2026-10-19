/** `color` at `fraction` opacity. Theme colours are #rrggbb; anything else is returned as it is. */
export function tint(color: string, fraction: number) {
  return /^#[\da-f]{6}$/i.test(color)
    ? `${color}${Math.round(Math.min(1, Math.max(0, fraction)) * 255)
        .toString(16)
        .padStart(2, "0")}`
    : color;
}
