import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTheme } from '../src/shared/theme/theme';
import { batteryColor } from '../src/shared/battery-color';
import { palettes, type Brand } from '../src/shared/theme/palettes';

function luminance(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [16, 8, 0].map((shift) => {
    const v = ((n >> shift) & 255) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const brands = Object.keys(palettes) as Brand[];

/** Every light surface a status figure is drawn on: cards, raised chips, brand and domain tints. */
function lightBackgrounds(brand: Brand) {
  const theme = createTheme('light', brand);
  return [
    theme.colors.background,
    theme.colors.surface,
    theme.colors.raised,
    theme.colors.brandSurface,
    ...Object.values(theme.tones).map((tone) => tone.background),
  ];
}

// #3019: amber and light green status text sat at 2 to 2.5:1 on pale cards in Light.
test('every status text colour in the light palette reaches 4.5:1 on every light card colour', () => {
  for (const brand of brands) {
    const theme = createTheme('light', brand);
    const text: Record<string, string> = {
      'status.success': theme.status.success,
      'status.warning': theme.status.warning,
      'status.danger': theme.status.danger,
      'status.info': theme.status.info,
      'anatomy.main': theme.anatomy.main,
      'anatomy.secondary': theme.anatomy.secondary,
      'anatomy.injured': theme.anatomy.injured,
      'anatomy.high': theme.anatomy.high,
      'colors.danger': theme.colors.danger,
      'macros.protein': theme.macros.protein,
      'macros.carbs': theme.macros.carbs,
      'macros.fat': theme.macros.fat,
      ...Object.fromEntries(Object.entries(theme.weatherColors).map(([k, v]) => [`uv.${k}`, v])),
      ...Object.fromEntries(theme.hrZoneColors.map((color, i) => [`hrZone.${i + 1}`, color])),
    };
    for (const [name, color] of Object.entries(text)) {
      for (const background of lightBackgrounds(brand)) {
        const ratio = contrast(color, background);
        assert.ok(ratio >= 4.5, `${brand} ${name} ${color} on ${background}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

test('the light muscle map has no near-black parts and the 15+ colour differs from the good one', () => {
  const theme = createTheme('light', 'green');
  for (const part of [theme.anatomy.untrained, theme.anatomy.head]) {
    assert.ok(luminance(part) > 0.5, `${part} is too dark on a white card`);
    assert.ok(contrast(part, theme.colors.surface) >= 1.3, `${part} vanishes on the card`);
  }
  assert.notEqual(theme.anatomy.high, theme.anatomy.main);
});

test('light progress tracks, gridlines and the coach button are visible and not black', () => {
  for (const brand of brands) {
    const theme = createTheme('light', brand);
    assert.ok(contrast(theme.colors.track, theme.colors.surface) >= 1.2, `${brand} track`);
    assert.ok(contrast(theme.colors.grid, theme.colors.surface) >= 1.3, `${brand} grid`);
    assert.notEqual(theme.coachFab.background.toLowerCase(), theme.colors.text.toLowerCase());
    assert.ok(contrast(theme.coachFab.foreground, theme.coachFab.background) >= 4.5, `${brand} fab`);
  }
});

// The dark theme is the shipped look; #3019 changes Light only.
test('dark theme colour tokens are unchanged', () => {
  const theme = createTheme('dark', 'green');
  assert.deepEqual(theme.status, {
    success: '#22c55e',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#60a5fa',
  });
  assert.deepEqual(theme.anatomy, {
    main: '#22c55e',
    secondary: '#f59e0b',
    injured: '#ef4444',
    untrained: '#3f3f3f',
    head: '#bebebe',
    outline: 'rgba(128,128,128,0.3)',
    high: theme.colors.brand,
  });
  assert.deepEqual(theme.weatherColors, {
    uvLow: '#22c55e',
    uvModerate: '#eab308',
    uvHigh: '#f97316',
    uvVeryHigh: '#ef4444',
    uvExtreme: '#8b5cf6',
  });
  assert.deepEqual(theme.macros, { protein: '#22c55e', carbs: '#3b82f6', fat: '#f97316' });
  assert.deepEqual(theme.hrZoneColors, ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444']);
  assert.equal(theme.colors.track, theme.colors.brandSurface);
  assert.equal(theme.colors.grid, '#ffffff18');
  assert.deepEqual(theme.coachFab, { background: '#fafafa', foreground: theme.colors.background });
  assert.equal(theme.colors.danger, '#ff8d86');
  for (const brand of brands) {
    const dark = createTheme('dark', brand);
    assert.equal(dark.colors.track, palettes[brand].dark.brandSurface);
    assert.equal(dark.anatomy.high, palettes[brand].dark.brand);
  }
});

// #2976: the Body Battery bar's "good" band is the success status colour, so it must read in both themes.
test('the Body Battery good colour reaches 4.5:1 on every card colour in both themes', () => {
  for (const mode of ['light', 'dark'] as const) {
    for (const brand of brands) {
      const theme = createTheme(mode, brand);
      const color = batteryColor('Good', theme);
      assert.equal(batteryColor('Charged', theme), color);
      const backgrounds = [
        theme.colors.background,
        theme.colors.surface,
        theme.colors.raised,
        theme.colors.brandSurface,
        ...Object.values(theme.tones).map((tone) => tone.background),
      ];
      for (const background of backgrounds) {
        const ratio = contrast(color, background);
        assert.ok(ratio >= 4.5, `${mode} ${brand} ${color} on ${background}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
});
