// Home's Energy hero (#2989): the size setting and the gauge geometry. The number itself, and the
// rule for which Body Battery figure it shows, are `energyHero` in
// packages/shared/src/health/body-battery-energy.ts; the weights and past days come later through
// a tuning proposal.

export const ENERGY_HERO_SIZES = ['full', 'compact', 'slim'] as const;
export type EnergyHeroSize = (typeof ENERGY_HERO_SIZES)[number];
export const DEFAULT_ENERGY_HERO_SIZE: EnergyHeroSize = 'full';
export const energyHeroSizeOptions = [
  { value: 'full', label: 'Full' },
  { value: 'compact', label: 'Compact' },
  { value: 'slim', label: 'Slim' },
];
export function energyHeroSize(value: string | undefined): EnergyHeroSize {
  return ENERGY_HERO_SIZES.find((size) => size === value) ?? DEFAULT_ENERGY_HERO_SIZE;
}

const clamp = (value: number) => Math.max(0, Math.min(100, value));

// ── Gauge geometry ─────────────────────────────────────────────────────────────────────────────
// Angles are degrees clockwise from 3 o'clock, y pointing down, as in SVG.

export type Point = { x: number; y: number };

export function polar(center: number, radius: number, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  return { x: center + radius * Math.cos(radians), y: center + radius * Math.sin(radians) };
}

/** The dial is a 240° arc opening at the bottom; the tide ring is the full circle from the top. */
export const DIAL = { start: 150, sweep: 240 } as const;
export const TIDE = { start: -90, sweep: 360 } as const;

export function angleAt(shape: { start: number; sweep: number }, level: number) {
  return shape.start + (shape.sweep * clamp(level)) / 100;
}

/** An SVG arc from one level to another along the gauge; null when it has no length. */
export function arcPath(
  shape: { start: number; sweep: number },
  center: number,
  radius: number,
  from: number,
  to: number,
): string | null {
  if (to - from < 0.05) {
    return null;
  }
  // A full circle cannot be one arc command (start equals end), so stop a hair short.
  const end = shape.sweep === 360 && to >= 100 ? 99.99 : to;
  const a = polar(center, radius, angleAt(shape, from));
  const b = polar(center, radius, angleAt(shape, end));
  const large = ((end - from) * shape.sweep) / 100 > 180 ? 1 : 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  return `M ${round(a.x)} ${round(a.y)} A ${radius} ${radius} 0 ${large} 1 ${round(b.x)} ${round(b.y)}`;
}

/** The morning notch: a short bar across the ring at the level the day opened. */
export function notch(
  shape: { start: number; sweep: number },
  center: number,
  radius: number,
  stroke: number,
  level: number,
): { from: Point; to: Point } {
  const degrees = angleAt(shape, level);
  return {
    from: polar(center, radius - stroke / 2 - 4, degrees),
    to: polar(center, radius + stroke / 2 + 4, degrees),
  };
}

/** Edge margin that leaves room for the notch, scaled to the gauge. */
export const gaugeMargin = (size: number) => Math.round(size / 20);

/**
 * A still water surface across `width`, `amplitude` high, as an SVG path closed down to `bottom`.
 * Still on purpose: the owner chose water that lowers over a drifting wave (#2989).
 */
export function waterPath(width: number, surface: number, bottom: number, amplitude: number) {
  const steps = 24;
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const x = (width * index) / steps;
    const y = surface + amplitude * Math.sin((index / steps) * Math.PI * 4);
    return `L ${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`;
  });
  return `M 0 ${bottom} ${points.join(' ')} L ${width} ${bottom} Z`;
}
