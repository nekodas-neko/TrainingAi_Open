import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../../scripts/lib/strip-comments.js';

const read = (p: string) => stripComments(readFileSync(path.join(process.cwd(), p), 'utf8'));

describe('RV-212 ① — a partial day is not an error', () => {
  const src = read('components/nutrition/calorie-balance-bar.tsx');

  // At 2 pm everybody is legitimately "well under", and painting the headline red presents that
  // as a fault. `energy-card.tsx` made this exact change for its own copy of the number and its
  // comment names this component as the one still doing it.
  it('the headline number is not painted by zone', () => {
    const headline = src.slice(src.indexOf('text-2xl font-bold tabular-nums'));
    const line = headline.slice(0, headline.indexOf('\n'));
    expect(line).not.toMatch(/zoneColor/);
  });

  // The other half is deliberate and must NOT be swept along: the label carries " so far" on the
  // current day, which is what makes the colour a running state rather than a verdict.
  it('the qualified label keeps its colour', () => {
    expect(src).toMatch(/style=\{\{ color: b\.zoneColor \}\}[\s\S]{0,120}zoneLabel/);
    expect(src).toMatch(/isToday \? ' so far' : ''/);
  });
});

describe('RV-212 ② — taken is not cancelled', () => {
  it('a logged supplement is muted, not struck through', () => {
    const src = read('components/nutrition/supplements-section.tsx');
    expect(src).not.toMatch(/line-through/);
    expect(src).toMatch(/s\.loggedToday && "text-muted-foreground"/);
    // The tick is what carries the meaning now, so it has to still be there.
    expect(src).toMatch(/s\.loggedToday && <CheckIcon/);
  });

  // A DISCONTINUED supplement is a different claim, and a strikethrough is right for it. The
  // sweep must not take this one with it.
  it('the manage sheet still strikes through an inactive supplement', () => {
    const src = read('components/nutrition/manage-supplements-sheet.tsx');
    expect(src).toMatch(/!s\.active \? 'line-through text-muted-foreground'/);
  });
});
