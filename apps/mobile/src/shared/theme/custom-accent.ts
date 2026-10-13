export function hueColor(hue: number, saturation = 0.8, lightness = 0.55): string {
  const h = (((hue % 360) + 360) % 360) / 60;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const channels =
    h < 1
      ? [chroma, x, 0]
      : h < 2
        ? [x, chroma, 0]
        : h < 3
          ? [0, chroma, x]
          : h < 4
            ? [0, x, chroma]
            : h < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return (
    '#' +
    channels
      .map((value) =>
        Math.round((value + lightness - chroma / 2) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
export function customAccent(hue: number, mode: 'light' | 'dark') {
  const dark = mode === 'dark';
  const background = dark ? hueColor(hue, 0.55, 0.03) : '#ffffff';
  const surface = dark ? hueColor(hue, 0.55, 0.055) : '#ffffff';
  const raised = dark ? hueColor(hue, 0.5, 0.08) : '#f5f5f5';
  let lightness = dark ? 0.65 : 0.4;
  let brand = hueColor(hue, 0.8, lightness);
  const brandSurface = hueColor(hue, dark ? 0.55 : 0.4, dark ? 0.12 : 0.96);
  while (contrast(brand, brandSurface) < 4.5 && lightness > 0.1 && lightness < 0.95) {
    lightness += dark ? 0.01 : -0.01;
    brand = hueColor(hue, 0.8, lightness);
  }
  return {
    background,
    surface,
    raised,
    brand,
    brandText: brand,
    onBrand: contrast(brand, '#000000') >= contrast(brand, '#ffffff') ? '#000000' : '#ffffff',
    brandSurface,
    brandBorder: hueColor(hue, 0.5, dark ? 0.27 : 0.8),
  };
}
