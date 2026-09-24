import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * RV-121 — two different numbers were sharing one name in the place where the owner chooses
 * between them.
 *
 * `oura-score-chip-row.tsx` labels the computed readiness score **"Readiness"**. The `moodWidget`
 * card is the subjective morning check-in and renders **"Exercise Readiness"** in its own heading
 * (`readiness-checkin-card.tsx`) — but all three affordances that *select* it called it
 * "Readiness": the More tab's widget picker, the Home colour swatch, and the hidden-sections
 * restore panel. Turning the wrong one on is the failure, and it is silent.
 *
 * The rule pinned here is the agreement, not the string: whatever the card calls itself is what
 * the pickers must call it, and neither may be the chip's bare "Readiness".
 */
describe('RV-121 — the moodWidget pickers name the card, not the score', () => {
  const CARD_HEADING = 'components/checkin/readiness-checkin-card.tsx';
  const CHIP_ROW = 'components/oura-score-chip-row.tsx';

  const PICKERS: [rel: string, marker: RegExp][] = [
    ['components/more/home-widgets-section.tsx', /key:\s*"moodWidget".*$/m],
    // `[^>]*` cannot be used here: the JSX attribute value contains an arrow function.
    ['components/home/home-card-widget.tsx', /^.*<ColorSwatchPicker.*onColorChange\('moodWidget'.*$/m],
    ['app/session-select/session-select-content.tsx', /card_moodWidget:\s*'[^']*'/m],
  ];

  it('reads the two names off the source rather than hardcoding them', () => {
    // A guard on the guard: if either anchor moves, every assertion below goes vacuous.
    expect(src(CARD_HEADING)).toContain('"Exercise Readiness"');
    expect(src(CHIP_ROW)).toMatch(/label:\s*"Readiness"/);
  });

  it.each(PICKERS)('%s labels the widget "Exercise Readiness"', (rel, marker) => {
    const line = src(rel).match(marker)?.[0];
    expect(line, `marker not found in ${rel} — the picker moved, not the label`).toBeTruthy();
    expect(line).toContain('Exercise Readiness');
  });

  it.each(PICKERS)('%s never labels it with the score\'s bare name', (rel, marker) => {
    const line = src(rel).match(marker)?.[0] ?? '';
    // "Exercise Readiness" contains "Readiness", so match the label slot, not the substring.
    expect(line).not.toMatch(/(label[=:]\s*|:\s*)["']Readiness( card)?["']/);
  });
});
