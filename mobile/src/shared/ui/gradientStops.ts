/** The colour stops of a CSS `linear-gradient(180deg, #rrggbb 0%, ..., transparent 100%)`. A transparent stop keeps the colour before it, at no opacity, as CSS blends it. */
export function gradientStops(css: string) {
  const stops = [...css.matchAll(/(#[\da-f]{6}|transparent)\s+(\d+)%/gi)];
  let last = '#000000';
  return stops.map((stop) => {
    const transparent = stop[1] === 'transparent';
    if (!transparent) last = stop[1];
    return { offset: `${stop[2]}%`, color: last, opacity: transparent ? 0 : 1 };
  });
}
