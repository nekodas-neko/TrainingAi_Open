"use client";

/** The circle-drawing half of the home score row. Split out of `oura-score-chip-row.tsx` when the
 *  2026-08-07 round added layout variants (tile/pill/rail) that draw no circle at all — the frames
 *  are pure presentation and were the bulk of that file. */

function polar(size: number, deg: number, r: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  const c = size / 2;
  return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
}

/** Default: a plain, closed circle outline — the calmest option. */
export function SolidRingFrame({ size }: { size: number }) {
  const r = size * 0.425;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="color-mix(in oklch, var(--foreground) 45%, transparent)" strokeWidth={2} />
    </svg>
  );
}

/** Open ring: a circle with a deliberate gap at the top, so it never reads as a "complete" shape. */
export function OpenRingFrame({ size }: { size: number }) {
  const r = size * 0.425;
  const p1 = polar(size, -55, r);
  const p2 = polar(size, 235, r);
  const path = `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 1 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
      <path d={path} fill="none" stroke="color-mix(in oklch, var(--foreground) 45%, transparent)" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

/** Perforated ring: small dots trace the circle instead of a solid stroke. */
export function PerforatedRingFrame({ size }: { size: number }) {
  const r = size * 0.425;
  const n = Math.round(size / 4.7);
  const dots = Array.from({ length: n }, (_, i) => polar(size, (i / n) * 360, r));
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
      {dots.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={1.7} fill="color-mix(in oklch, var(--foreground) 45%, transparent)" />
      ))}
    </svg>
  );
}

/** Accent ring: the design shipped just before the 2026-07-23 round — a thin track + one
 *  fixed-position, fixed-length accent arc in the card's identity colour. Reproduces the original
 *  geometry exactly (its own angle convention, 0° = 3 o'clock — distinct from the other frames'
 *  12-o'clock convention above) rather than approximating it, since the point is to offer back
 *  exactly what was live. */
export function AccentRingFrame({ size, accent }: { size: number; accent: string }) {
  const r = size * 0.425;
  const c = size / 2;
  const at = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
  };
  const p1 = at(-125);
  const p2 = at(-55);
  const path = `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
      <circle cx={c} cy={c} r={r} fill="none" stroke="color-mix(in oklch, var(--foreground) 35%, transparent)" strokeWidth={2} />
      <path d={path} fill="none" stroke={accent} strokeWidth={3.5} strokeLinecap="round" />
    </svg>
  );
}

/** Halo: no stroke at all — a soft blurred glow in the card's identity colour sitting behind the
 *  icon and number, in place of a hard-edged frame. */
export function HaloFrame({ accent }: { accent: string }) {
  return (
    <span
      className="absolute rounded-full"
      style={{ inset: "-14%", filter: "blur(16px)", opacity: 0.55, background: `radial-gradient(circle, ${accent} 0%, transparent 68%)` }}
      aria-hidden
    />
  );
}
