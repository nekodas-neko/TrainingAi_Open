import { describe, expect, it } from 'vitest';
import { supplementSubtitle } from '../supplement-subtitle';

const s = (o: Partial<Parameters<typeof supplementSubtitle>[0]>) =>
  supplementSubtitle({ dose: null, defaultAmount: null, unit: null, loggedAmount: null, ...o } as Parameters<typeof supplementSubtitle>[0]);

describe('supplementSubtitle', () => {
  it('says nothing when the supplement carries nothing', () => {
    expect(s({})).toBeNull();
    expect(s({ dose: '   ' })).toBeNull();
  });

  it('falls back to the free-text dose', () => {
    expect(s({ dose: '1 capsule' })).toBe('1 capsule');
  });

  it('prefers the structured amount over the free text', () => {
    expect(s({ dose: '5g', defaultAmount: 5, unit: 'g' })).toBe('5 g');
  });

  it('renders an amount with no unit rather than refusing', () => {
    expect(s({ defaultAmount: 2 })).toBe('2');
  });

  // The point of the helper: editing the definition must not rewrite what today recorded.
  it("shows what was logged today, not what the definition now says", () => {
    expect(s({ defaultAmount: 5, unit: 'mg', loggedAmount: { amount: 2.5, unit: 'mg', contributions: 1 } }))
      .toBe('2.5 mg today');
  });

  it('counts a second dose instead of hiding it', () => {
    expect(s({ loggedAmount: { amount: 10, unit: 'mg', contributions: 2 } })).toBe('10 mg today · 2 doses');
  });

  // A tick with no number means "taken", not "took none of it".
  it('does not render a null logged amount as zero', () => {
    expect(s({ dose: '1 capsule', loggedAmount: { amount: null, unit: null, contributions: 1 } }))
      .toBe('1 capsule');
    expect(s({ defaultAmount: 5, unit: 'mg', loggedAmount: { amount: null, unit: null, contributions: 1 } }))
      .toBe('5 mg');
  });

  it('takes the unit from the log when it has one, and the definition otherwise', () => {
    expect(s({ unit: 'mg', loggedAmount: { amount: 4, unit: 'mcg', contributions: 1 } })).toBe('4 mcg today');
    expect(s({ unit: 'mg', loggedAmount: { amount: 4, unit: null, contributions: 1 } })).toBe('4 mg today');
  });
});
