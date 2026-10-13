import { describe, expect, it } from 'vitest';
import { foodLoggingCoverage } from '../logging-completeness';
import { mergeMovementIntervals } from '@/lib/health/movement-intervals';
import { activeKcalMetCandidates } from '@trainingai/shared/inputs/adapters';
import { unrecordedMealEstimatesAllowed } from '@trainingai/shared/nutrition/meal-logging-status';
describe('native compatibility regressions', () => {
  it('preserves legacy completion when default rows exist or the lookup fails', async () => {
    const date = '2026-10-12';
    const repo = {
      listMealLoggingCompleteness: async () => [{ date, complete: false, explicit: false }],
    };
    expect((await foodLoggingCoverage(repo, 'u', date, date, [date])).complete.has(date)).toBe(
      true,
    );
    repo.listMealLoggingCompleteness = async () => {
      throw new Error('offline');
    };
    expect((await foodLoggingCoverage(repo, 'u', date, date, [date])).complete.has(date)).toBe(
      true,
    );
    expect(unrecordedMealEstimatesAllowed([{ explicit: false }])).toBe(true);
    expect(unrecordedMealEstimatesAllowed([{ explicit: true }])).toBe(false);
  });
  it('counts confirmed fasting, but never treats incomplete tracking as zero intake', async () => {
    const rows = [
      { date: '2026-10-12', complete: true, zeroIntake: true, explicit: true },
      { date: '2026-10-13', complete: false, zeroIntake: false, explicit: true },
    ];
    const result = await foodLoggingCoverage(
      { listMealLoggingCompleteness: async () => rows },
      'u',
      '2026-10-12',
      '2026-10-13',
      ['2026-10-13'],
    );
    expect([...result.complete]).toEqual(['2026-10-12']);
    expect([...result.zeroIntake]).toEqual(['2026-10-12']);
  });
  it('does not double-count one calorie record received through both clients', () => {
    const row = {
      kind: 'active_kcal' as const,
      recordId: 'record',
      startAt: new Date('2026-10-12T01:00:00Z'),
      endAt: new Date('2026-10-12T01:01:00Z'),
      value: 5,
      dataOrigin: 'com.test.watch',
      deviceType: null,
    };
    const merged = mergeMovementIntervals(
      [row],
      [{ ...row, recordId: 'health_connect:record' }],
    );
    expect(merged).toHaveLength(1);
    const candidates = (rows: typeof merged) =>
      activeKcalMetCandidates(
        rows.map((row) => ({
          startMs: row.startAt.getTime(),
          endMs: row.endAt.getTime(),
          kcal: row.value,
          source: row.dataOrigin!,
        })),
        70,
      );
    expect(candidates(merged)).toEqual(candidates([row]));
  });
});
