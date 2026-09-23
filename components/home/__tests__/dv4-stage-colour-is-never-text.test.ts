import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { STAGE_COLOR } from '@trainingai/shared/health/hypnogram';

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * DV-4 — Home's Sleep card printed the Deep hours in the Deep stage colour, measured at about 1:1
 * against the card on the S25.
 *
 * **The durable rule is not "fix that span", it is "a stage colour is a FILL".** Stage colours are
 * chosen to read against each other in a stacked bar, not against a background — and Home's card
 * background is owner-customisable (`ColorSwatchPicker`, `cardColors.sleepWidget`), so there is no
 * card colour for which every stage colour is legible. Four surfaces import `STAGE_COLOR`; three
 * already used it only as a fill, and `health-metric-sheet.tsx` renders the identical legend with
 * the value in the inherited foreground. That was the shape to copy.
 */
describe('DV-4 — STAGE_COLOR is a fill, never text', () => {
  const consumers = () =>
    execFileSync('git', ['ls-files', 'app', 'components'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(f => /\.tsx?$/.test(f) && !f.includes('__tests__'))
      .filter(f => /\bSTAGE_COLOR\b/.test(src(f)));

  it('finds the surfaces that import the stage palette at all', () => {
    // A guard on the guard: if this ever returns nothing, every assertion below passes vacuously.
    const files = consumers();
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files).toContain('components/home/home-card-widget.tsx');
  });

  it('never assigns a stage colour to a CSS `color`', () => {
    const offenders: string[] = [];
    for (const f of consumers()) {
      src(f).split('\n').forEach((line, i) => {
        // Only a STYLE object is the bug. `{ label: 'Deep', color: STAGE_COLOR.deep }` is a data
        // field that happens to be named `color`, and both consumers legitimately build one; what
        // must never appear is that value reaching a CSS `color`. Lowercase `color:` also excludes
        // `backgroundColor:` on its own, and `background: s.color` has no colon after `color`.
        if (!/style=/.test(line)) return;
        if (/\bcolor:\s*(STAGE_COLOR|s\.color)/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders, 'a stage colour used as text is DV-4 reintroduced').toEqual([]);
  });

  it("keeps the Sleep card's dot and stacked bar coloured, so this was not 'fixed' by deleting the palette", () => {
    const home = src('components/home/home-card-widget.tsx');
    const fills = home.match(/background: s\.color/g) ?? [];
    expect(fills.length, 'the legend dot and the stacked bar segment').toBe(2);
  });

  it('pins the measurement that makes this a contrast bug rather than a preference', () => {
    // sRGB relative luminance (WCAG 2.x). The page root behind the card is oklch(0.145 0.02 215),
    // ~rgb(9,22,26); the card's own paint is lighter still, so this ratio is the OPTIMISTIC one and
    // the real reading on device was worse.
    const lum = (hex: string) => {
      const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    expect(STAGE_COLOR.deep).toBe('#1e3a70');
    expect(ratio(STAGE_COLOR.deep, '#09161a')).toBeLessThan(4.5);
  });
});
