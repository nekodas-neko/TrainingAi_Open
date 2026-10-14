import { describe, expect, it } from 'vitest';
import { projectHealthConnect } from '../health-connect-projection';
import type { HealthConnectRecord } from '../../validation/health-connect-import';
const base = {
  id: 'sleep',
  type: 'SleepSession' as const,
  sourcePackage: 'com.test.watch',
  recordingMethod: 2,
  modifiedAt: '2026-10-13T08:00:00Z',
  start: '2026-10-12T22:00:00Z',
  end: '2026-10-13T06:00:00Z',
};
describe('native Health Connect sleep and HRV', () => {
  it('keeps deep/light hours and hypnogram codes correctly mapped', () => {
    const result = projectHealthConnect(
      [
        {
          ...base,
          stages: [
            { kind: 'deep', start: base.start, end: '2026-10-13T00:00:00Z' },
            { kind: 'light', start: '2026-10-13T00:00:00Z', end: base.end },
          ],
        },
      ],
      'UTC',
      Date.parse('2026-10-13T12:00:00Z'),
    );
    expect(result.sleep[0].deepSleepHours).toBe(2);
    expect(result.sleep[0].lightSleepHours).toBe(6);
    expect(
      result.sleep[0].sleepPhase5Min?.split('').filter((stage) => stage === '1'),
    ).toHaveLength(24);
    expect(
      result.sleep[0].sleepPhase5Min?.split('').filter((stage) => stage === '2'),
    ).toHaveLength(72);
  });
  it('uses the recorded sleep window rather than midnight to 8am for shift workers', () => {
    const sleep = {
      ...base,
      start: '2026-10-13T09:00:00Z',
      end: '2026-10-13T17:00:00Z',
      stages: [],
    };
    const hrv = (id: string, at: string, value: number): HealthConnectRecord => ({
      ...base,
      id,
      type: 'HeartRateVariabilityRmssd',
      start: at,
      end: at,
      value,
    });
    const result = projectHealthConnect(
      [
        sleep,
        hrv('asleep', '2026-10-13T11:00:00Z', 80),
        hrv('awake', '2026-10-13T03:00:00Z', 200),
      ],
      'UTC',
      Date.parse('2026-10-13T18:00:00Z'),
    );
    expect(result.daily.find((day) => day.hrvMs != null)?.hrvMs).toBe(80);
    expect(
      projectHealthConnect(
        [hrv('without-sleep', '2026-10-13T03:00:00Z', 200)],
        'UTC',
        Date.parse('2026-10-13T18:00:00Z'),
      ).daily,
    ).toEqual([]);
  });
});
