/**
 * A hex colour with its opacity scaled, the way Tailwind's `border-border/60` scales a token that
 * may already carry alpha (`#ffffff18` is 9%, so 60% of it is 5%).
 */
export function scaleAlpha(color: string, factor: number) {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!match) return color;
  const alpha = match[2] ? parseInt(match[2], 16) : 255;
  const scaled = Math.round(Math.min(1, Math.max(0, factor)) * alpha);
  return `#${match[1]}${scaled.toString(16).padStart(2, '0')}`;
}
