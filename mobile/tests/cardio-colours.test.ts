import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTheme } from '../src/shared/theme/theme';

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

// The Cardio Hub and Heart rate status colours: counted / good, didn't count / watch, bad,
// and the PROGRAM badge text on its pill. Each must read in both themes.
test('cardio status colours reach 4.5:1 on the card surface in both themes', () => {
  for (const mode of ['light', 'dark'] as const) {
    const theme = createTheme(mode, 'green');
    const pairs: [string, string, string][] = [
      ['good', theme.progress.trendUp, theme.colors.surface],
      ['watch', theme.tones.checkin.foreground, theme.colors.surface],
      ['bad', theme.colors.danger, theme.colors.surface],
      ['chart line', theme.progress.trendUp, theme.colors.surface],
      ['PROGRAM badge', theme.colors.text, theme.tones.recovery.border],
    ];
    for (const [name, fg, bg] of pairs) {
      assert.ok(contrast(fg, bg) >= 4.5, `${mode} ${name}: ${contrast(fg, bg).toFixed(2)}:1`);
    }
  }
});
