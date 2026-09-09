import { describe, expect, it } from 'vitest';
import { applyManualToggle } from '@/components/nutrition/supplement-day-totals';
// LB-57: the derivation is shared now — this file's cases were written against the ADAPTER's
// semantics on purpose, so they are the right ones to hold the shared version to.
import { summariseSupplementDay } from '@trainingai/shared/nutrition/supplement-day-totals';
import type { LocalSupplementLog } from '@/lib/local-store/types';

const log = (o: Partial<LocalSupplementLog> & { supplementId: string }): LocalSupplementLog => ({
  id: crypto.randomUUID(), logDate: '2026-09-06', updatedAt: '2026-09-06T00:00:00Z',
  deletedAt: null, syncStatus: 'synced', ...o,
});

describe('summariseSupplementDay — the device half of what listSupplements derives', () => {
  it('sums every live contribution and counts them', () => {
    const day = summariseSupplementDay([
      log({ supplementId: 'a', amount: 5, unit: 'g', source: 'manual' }),
      log({ supplementId: 'a', amount: 3, unit: 'g', source: 'meal' }),
    ]);
    expect(day.get('a')!.loggedAmount).toEqual({ amount: 8, unit: 'g', contributions: 2 });
  });

  it('leaves the amount null when no contribution carried a number', () => {
    // A tick means "taken", not "took none of it" — 0 here is the unknown-coerced-to-zero mistake.
    const day = summariseSupplementDay([log({ supplementId: 'a', source: 'manual' })]);
    expect(day.get('a')!.loggedAmount).toEqual({ amount: null, unit: null, contributions: 1 });
  });

  it('sums the numbers it does have across a mixed day', () => {
    const day = summariseSupplementDay([
      log({ supplementId: 'a', amount: null, source: 'manual' }),
      log({ supplementId: 'a', amount: 2, unit: 'mg', source: 'meal' }),
    ]);
    expect(day.get('a')!.loggedAmount).toEqual({ amount: 2, unit: 'mg', contributions: 2 });
  });

  it('sets loggedToday from the manual contribution only', () => {
    // A meal turning the tick on leaves a control that refuses to turn off.
    const day = summariseSupplementDay([log({ supplementId: 'a', amount: 1, source: 'meal' })]);
    expect(day.get('a')).toMatchObject({ loggedToday: false });
    expect(day.get('a')!.loggedAmount.contributions).toBe(1);
  });

  it('treats an absent source as manual, because every pre-BF-69 writer omits it', () => {
    const day = summariseSupplementDay([log({ supplementId: 'a', amount: 1 })]);
    expect(day.get('a')!.loggedToday).toBe(true);
  });

  it('skips a locally tombstoned row', () => {
    const day = summariseSupplementDay([
      log({ supplementId: 'a', amount: 5, source: 'manual', deletedAt: '2026-09-06T01:00:00Z' }),
    ]);
    expect(day.has('a')).toBe(false);
  });

  it('keeps the FIRST unit any contribution supplies, not the last', () => {
    // The sum-and-count case above uses one unit on both rows, so first-wins and last-wins agree
    // there and neither is tested by it. A day whose contributions disagree is what separates them.
    const day = summariseSupplementDay([
      log({ supplementId: 'a', amount: 5, unit: 'mg', source: 'manual' }),
      log({ supplementId: 'a', amount: 3, unit: 'g', source: 'meal' }),
    ]);
    expect(day.get('a')!.loggedAmount.unit).toBe('mg');
  });

  it('takes the unit from the first contribution that HAS one', () => {
    const day = summariseSupplementDay([
      log({ supplementId: 'a', amount: 5, source: 'manual' }),
      log({ supplementId: 'a', amount: 3, unit: 'g', source: 'meal' }),
    ]);
    expect(day.get('a')!.loggedAmount.unit).toBe('g');
  });

  it('takes loggedDose from the manual row, and a meal contribution never sets it', () => {
    // The server's half of the same rule: `loggedDose` is what the supplements page shows and
    // unticks, so a meal's dose must not become "the row".
    const day = summariseSupplementDay([
      log({ supplementId: 'a', amount: 3, unit: 'mg', doseText: '3 mg', source: 'meal' }),
      log({ supplementId: 'a', amount: 5, unit: 'mg', doseText: '5 mg', source: 'manual' }),
      log({ supplementId: 'b', amount: 2, unit: 'mg', doseText: '2 mg', source: 'meal' }),
    ]);
    expect(day.get('a')!.loggedDose).toEqual({ amount: 5, unit: 'mg', doseText: '5 mg' });
    expect(day.get('b')!.loggedDose).toBeNull();
    expect(day.get('b')!.loggedToday).toBe(false);
  });

  it('keeps supplements apart', () => {
    const day = summariseSupplementDay([
      log({ supplementId: 'a', amount: 5, unit: 'mg' }),
      log({ supplementId: 'b', amount: 1, unit: 'g' }),
    ]);
    expect(day.get('a')!.loggedAmount.amount).toBe(5);
    expect(day.get('b')!.loggedAmount.unit).toBe('g');
  });
});

describe('applyManualToggle — the tick, before the round trip', () => {
  it('adds a prompted dose to a day that already had one', () => {
    expect(applyManualToggle({ amount: 3, unit: 'mg', contributions: 1 },
      { logging: true, amount: 7.5, unit: 'mg' }))
      .toEqual({ amount: 10.5, unit: 'mg', contributions: 2 });
  });

  it('opens the day when there was nothing logged', () => {
    expect(applyManualToggle(null, { logging: true, amount: 5, unit: 'mg' }))
      .toEqual({ amount: 5, unit: 'mg', contributions: 1 });
  });

  it('counts a numberless tick without inventing a zero', () => {
    expect(applyManualToggle(null, { logging: true, amount: null, unit: null }))
      .toEqual({ amount: null, unit: null, contributions: 1 });
  });

  it('clears the day when the only contribution is removed', () => {
    expect(applyManualToggle({ amount: 5, unit: 'mg', contributions: 1 },
      { logging: false, amount: 5, unit: 'mg' })).toBeNull();
  });

  it('subtracts only its own number when other contributions remain', () => {
    expect(applyManualToggle({ amount: 8, unit: 'g', contributions: 2 },
      { logging: false, amount: 5, unit: 'g' }))
      .toEqual({ amount: 3, unit: 'g', contributions: 1 });
  });

  it('leaves the sum alone when the removed contribution carried no number', () => {
    expect(applyManualToggle({ amount: 3, unit: 'mg', contributions: 2 },
      { logging: false, amount: null, unit: null }))
      .toEqual({ amount: 3, unit: 'mg', contributions: 1 });
  });
});
