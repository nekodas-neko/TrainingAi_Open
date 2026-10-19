import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { sizes, typography } from '../src/shared/theme/tokens';

// #2994. Preview restores the current app's look, so its type tokens are pinned to what the current
// app's components draw at 384 px, measured in its dark theme (one CSS px is one dp on the S25
// Ultra). Each row names where the web value comes from; change a token only with its source.
type Expected = {
  fontSize: number;
  lineHeight: number;
  fontWeight?: string;
  letterSpacing?: number;
  uppercase?: boolean;
  source: string;
};
const currentApp: Record<string, Expected> = {
  pageTitle: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    source: 'shell/screen-header.tsx h1, text-xl font-bold',
  },
  nutritionTitle: {
    fontSize: 26,
    lineHeight: 26,
    fontWeight: '600',
    letterSpacing: -0.52,
    source: 'nutrition-content.tsx h1, text-[26px] font-semibold leading-none tracking-[-0.02em]',
  },
  heading: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    source: 'text-base font-semibold (empty states, sheet titles)',
  },
  subheading: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    source: 'text-sm font-semibold (a heading inside a card)',
  },
  cardTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 1.2,
    uppercase: true,
    source: 'text-xs font-semibold uppercase tracking-widest (health card titles)',
  },
  groupTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
    uppercase: true,
    source: 'health/section-header.tsx, text-xs font-semibold uppercase tracking-wide',
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '600',
    letterSpacing: 1,
    uppercase: true,
    source: 'text-[10px] font-semibold uppercase tracking-widest (more-row.tsx group labels)',
  },
  body: { fontSize: 14, lineHeight: 20, fontWeight: undefined, source: 'text-sm' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '400', source: 'more-row.tsx row label, text-sm' },
  button: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    source: 'ui/button.tsx, text-sm font-medium',
  },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: undefined, source: 'text-xs' },
  tab: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '500',
    source: 'shell/bottom-nav.tsx, text-[10px] font-medium',
  },
  calendarDay: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    source: 'calendar-widget.tsx day digit and month name, text-xs font-medium',
  },
  calendarWeekday: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '500',
    source: 'calendar-widget.tsx weekday row, text-[10px] font-medium (measured 10/15)',
  },
  statLabel: {
    fontSize: 9,
    lineHeight: 13.5,
    fontWeight: undefined,
    letterSpacing: 0.45,
    uppercase: true,
    source: 'observed-hr-card.tsx Stat label, text-[9px] uppercase tracking-wider',
  },
  statValue: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600',
    source: 'observed-hr-card.tsx Stat value, text-xl font-semibold',
  },
  statValueStrong: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    source: 'observed-hr-card.tsx emphasised Stat value, text-2xl font-bold',
  },
  statUnit: {
    fontSize: 9,
    lineHeight: 13.5,
    fontWeight: undefined,
    source: 'observed-hr-card.tsx Stat unit, text-[9px]',
  },
  weekTileValue: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    source: 'week-metric-card.tsx value, text-xl font-bold',
  },
  weekTileDelta: {
    fontSize: 11,
    lineHeight: 16.5,
    fontWeight: undefined,
    source: 'week-metric-card.tsx delta, text-[11px]',
  },
  factorLabel: {
    fontSize: 11,
    lineHeight: 13.75,
    fontWeight: undefined,
    source: 'contributor-chart.tsx FactorBar name, text-[11px] leading-tight',
  },
  factorValue: {
    fontSize: 11,
    lineHeight: 16.5,
    fontWeight: '600',
    source: 'contributor-chart.tsx FactorBar value, text-[11px] font-semibold',
  },
  input: { fontSize: 16, lineHeight: 24, source: 'globals.css forces 16 px on input, textarea, select' },
};

const sourceRoot = new URL('../src/', import.meta.url);

async function sources() {
  const files = (await readdir(sourceRoot, { recursive: true }))
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => /\.tsx?$/.test(file));
  return Promise.all(
    files.map(async (file) => ({ file, text: await readFile(new URL(file, sourceRoot), 'utf8') })),
  );
}

test('type tokens match the current app', () => {
  for (const [variant, expected] of Object.entries(currentApp)) {
    const token = typography[variant as keyof typeof typography] as Record<string, unknown>;
    assert.ok(token, `missing type token ${variant}`);
    const where = `${variant} (${expected.source})`;
    assert.equal(token.fontSize, expected.fontSize, `${where}: size`);
    assert.equal(token.lineHeight, expected.lineHeight, `${where}: line height`);
    if ('fontWeight' in expected) assert.equal(token.fontWeight, expected.fontWeight, `${where}: weight`);
    assert.equal(token.letterSpacing, expected.letterSpacing, `${where}: letter spacing`);
    assert.equal(token.textTransform, expected.uppercase ? 'uppercase' : undefined, `${where}: case`);
  }
});

test('page titles use the page title tokens, never the large value token', async () => {
  const files = new Map((await sources()).map(({ file, text }) => [file, text]));
  const layout = files.get('shared/ui/PageLayout.tsx') ?? '';
  const screen = files.get('shared/ui/Screen.tsx') ?? '';
  assert.match(layout, /titleVariant = 'pageTitle'/);
  assert.doesNotMatch(layout, /'title'/, 'PageLayout draws a page title with the 28 px value token');
  assert.doesNotMatch(screen, /'title'/, 'Screen draws a page title with the 28 px value token');
});

test('the tap target and input size follow the current app stylesheet', async () => {
  const css = await readFile(new URL('../../app/globals.css', import.meta.url), 'utf8');
  const floor = /button,\s*\[role="button"\]\s*\{\s*min-height:\s*(\d+)px/.exec(css);
  assert.ok(floor, 'tap-target floor not found in app/globals.css');
  assert.equal(sizes.touchTarget, Number(floor[1]));
  const input = /input,\s*textarea,\s*select\s*\{\s*font-size:\s*(\d+)px/.exec(css);
  assert.ok(input, 'input font-size rule not found in app/globals.css');
  assert.equal(typography.input.fontSize, Number(input[1]));
});

test('calendar digits, the Nutrition action row and the Heart rate tiles use the web sizes', async () => {
  assert.equal(sizes.calendarDay, 28, 'calendar-widget.tsx day circle is h-7 w-7');
  assert.equal(sizes.iconCompact, 16, 'nutrition-action-row.tsx icons are w-4 h-4');
  const files = new Map((await sources()).map(({ file, text }) => [file, text]));
  const calendar = files.get('shared/ui/MonthCalendar.tsx') ?? '';
  assert.match(calendar, /variant="calendarWeekday"/);
  assert.match(calendar, /variant="calendarDay"/);
  const action = files.get('shared/ui/ActionTile.tsx') ?? '';
  assert.match(action, /variant="subheading"/, 'Log Food, Water and My Foods are text-sm font-semibold');
  const heart = files.get('features/health/components/RecordedHealthCards.tsx') ?? '';
  assert.equal((heart.match(/^\s+stat$/gm) ?? []).length >= 3, true, 'Heart rate tiles use the stat tile');
});

test('text sizes come only from the tokens, through the scaled primitives', async () => {
  const primitives = new Set([
    'shared/ui/AppText.tsx',
    'shared/ui/TextField.tsx',
    'shared/ui/ChatComposer.tsx',
  ]);
  const errors: string[] = [];
  for (const { file, text } of await sources()) {
    if (file !== 'shared/theme/tokens.ts' && /(?<![.\w])(fontSize|lineHeight)[ \t]*:/.test(text)) {
      errors.push(`${file}: sets fontSize/lineHeight outside the type tokens`);
    }
    const nativeText = /import\s*\{[^}]*\b(Text|TextInput)\b[^}]*\}\s*from\s*'react-native'/.test(text);
    if (nativeText && !primitives.has(file)) {
      errors.push(`${file}: renders react-native Text directly; use AppText or TextField`);
    }
    if (primitives.has(file)) {
      if (!/allowFontScaling=\{allowFontScaling\}/.test(text)) {
        errors.push(`${file}: must take allowFontScaling from the theme (text-scale.ts)`);
      }
      if (!/maxFontSizeMultiplier=\{MAX_TEXT_SCALE\}/.test(text)) {
        errors.push(`${file}: must cap growth with maxFontSizeMultiplier={MAX_TEXT_SCALE}`);
      }
    }
    if (file !== 'shared/theme/ThemeProvider.tsx' && /\bfontScale\b\s*\}\s*=\s*useWindowDimensions|useWindowDimensions\(\)\.fontScale/.test(text)) {
      errors.push(`${file}: reads the raw system font scale; use textScale from useTheme()`);
    }
    for (const line of text.split('\n')) {
      if (line.includes('getFontScale(') && !line.includes('textScale(')) {
        errors.push(`${file}: reads the raw system font scale; pass it through textScale()`);
      }
    }
  }
  assert.deepEqual(errors, [], errors.join('\n'));
});
