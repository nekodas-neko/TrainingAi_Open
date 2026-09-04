import { describe, expect, it } from 'vitest';
import { latestDisplayedBodyFat } from '../body-fat-display';

/** Rows are newest-first, as `metaRecentReversed` supplies them. */
const row = (o: Partial<{ bodyFat: number | null; bodyFatCorrected: number | null; bodyFatIsCorrected: boolean }>) => ({
  bodyFat: null, bodyFatCorrected: null, bodyFatIsCorrected: false, ...o,
});

describe('latestDisplayedBodyFat', () => {
  it('has nothing to report when no row carries a body fat', () => {
    expect(latestDisplayedBodyFat([row({}), row({})])).toEqual({ value: null, corrected: false });
    expect(latestDisplayedBodyFat([])).toEqual({ value: null, corrected: false });
  });

  it('prefers the corrected figure and says it was corrected', () => {
    expect(latestDisplayedBodyFat([row({ bodyFat: 30.4, bodyFatCorrected: 27.9, bodyFatIsCorrected: true })]))
      .toEqual({ value: 27.9, corrected: true });
  });

  it('reports an uncorrected reading as uncorrected', () => {
    expect(latestDisplayedBodyFat([row({ bodyFat: 30.4 })])).toEqual({ value: 30.4, corrected: false });
  });

  // The reason this helper exists: `.map(displayBodyFat).find(...)` gets the number right and loses
  // the row, so the flag would have to be read off some other reading.
  it('takes the flag from the row the value came from, not the newest row', () => {
    const rows = [
      row({}),                                                                    // newest, no body fat
      row({ bodyFat: 30.4, bodyFatCorrected: 27.9, bodyFatIsCorrected: true }),    // the one shown
      row({ bodyFat: 31.0 }),                                                     // older, uncorrected
    ];
    expect(latestDisplayedBodyFat(rows)).toEqual({ value: 27.9, corrected: true });
  });

  it('does not call an uncorrected newer reading calibrated because an older one was', () => {
    const rows = [
      row({ bodyFat: 31.0 }),
      row({ bodyFat: 30.4, bodyFatCorrected: 27.9, bodyFatIsCorrected: true }),
    ];
    expect(latestDisplayedBodyFat(rows)).toEqual({ value: 31.0, corrected: false });
  });

  // body-fat-display.ts: an offset can round to zero, and "corrected by 0.0" and "not corrected"
  // are different claims — so the flag is the authority, never a comparison of the two numbers.
  it('trusts the flag over a zero-sized correction', () => {
    expect(latestDisplayedBodyFat([row({ bodyFat: 27.9, bodyFatCorrected: 27.9, bodyFatIsCorrected: true })]))
      .toEqual({ value: 27.9, corrected: true });
  });
});
