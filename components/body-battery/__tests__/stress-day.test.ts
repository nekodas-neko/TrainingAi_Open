import { describe, expect, it } from 'vitest';
import { clockSkipOnDay, dateStrMidnightInTz } from '@trainingai/shared/date-utils';
import { minutesIntoDay, toSegments, coveredMinutes } from '../stress-day';

const TZ = 'Australia/Brisbane'; // UTC+10, no DST — the owner's zone.

/** A bucket at a Brisbane wall-clock time on a fixed day, expressed as the UTC instant it is. */
const at = (hh: number, mm: number, level: number) => ({
  t: Date.UTC(2026, 8, 8, hh, mm) - 10 * 3600_000,
  level,
});

describe('placing a bucket on the clock', () => {
  it('uses the user timezone, not the runner’s', () => {
    // 03:15 UTC is 13:15 in Brisbane. A device-local reading gives a different answer on every
    // machine but one — the bug class CLAUDE.md's timezone rule exists for.
    expect(minutesIntoDay(Date.UTC(2026, 8, 8, 3, 15), TZ)).toBe(13 * 60 + 15);
    expect(minutesIntoDay(Date.UTC(2026, 8, 8, 3, 15), 'Etc/GMT+5')).toBe(22 * 60 + 15);
  });

  it('places local midnight at 0, not 1440', () => {
    // `en-GB` renders midnight as 24:00, which would put the day's first bucket off the right edge
    // of the axis instead of at the left.
    expect(minutesIntoDay(Date.UTC(2026, 8, 7, 14, 0), TZ)).toBe(0);
  });
});

describe('gaps are gaps', () => {
  it('breaks a run where the ring stopped recording', () => {
    // The measured hole on 2026-09-08: 06:45 → 13:15, six and a half hours. One joined path across
    // it would draw a stress level for a window nobody measured.
    const segments = toSegments(
      [at(6, 15, -0.2), at(6, 45, -0.3), at(13, 15, -0.6), at(13, 45, -0.7)],
      TZ,
    );
    expect(segments).toHaveLength(2);
    expect(segments[0].map(p => p.x)).toEqual([6 * 60 + 15, 6 * 60 + 45]);
    expect(segments[1].map(p => p.x)).toEqual([13 * 60 + 15, 13 * 60 + 45]);
  });

  it('tolerates one dropped reading without splitting', () => {
    // The ring stops sampling when you are still, so a single missing bucket is normal and must not
    // read as a hole. One drop stays one line; two is a hole.
    expect(toSegments([at(9, 0, -0.1), at(10, 0, -0.2)], TZ)).toHaveLength(1);
    expect(toSegments([at(9, 0, -0.1), at(10, 30, -0.2)], TZ)).toHaveLength(2);
  });

  it('sorts before segmenting', () => {
    // Today's series arrives ordered; a day assembled from stored rows carries no such guarantee,
    // and an out-of-order point draws a line doubling back on itself.
    const segments = toSegments([at(14, 0, -0.5), at(9, 0, -0.1), at(9, 30, -0.2)], TZ);
    expect(segments).toHaveLength(2);
    expect(segments[0][0].x).toBe(9 * 60);
  });

  it('is empty for no buckets rather than one empty run', () => {
    expect(toSegments([], TZ)).toEqual([]);
  });
});

describe('how much of the day was actually measured', () => {
  it('counts a lone bucket as its own half hour', () => {
    expect(coveredMinutes(toSegments([at(9, 0, -0.1)], TZ))).toBe(30);
  });

  it('counts a run as its span plus a half-bucket at each end', () => {
    // 09:00 → 10:00 spans 60 minutes of midpoints and covers 90 of clock. Without the half-bucket
    // ends, one reading and two adjacent readings would report the same coverage.
    expect(coveredMinutes(toSegments([at(9, 0, -0.1), at(9, 30, -0.2), at(10, 0, -0.3)], TZ))).toBe(90);
  });

  it('does not count the hole between two runs', () => {
    // The whole point of the figure: 13.3 of 24 hours is the honest reading, and a coverage number
    // that swallowed gaps would make a sparse day look complete.
    const segments = toSegments([at(6, 15, -0.2), at(6, 45, -0.3), at(13, 15, -0.6)], TZ);
    expect(coveredMinutes(segments)).toBe(60 + 30);
  });
});

describe('daylight-saving days in Sydney', () => {
  const SYD = 'Australia/Sydney';
  // 2026-10-04 spring forward: 02:00 AEST (UTC+10) becomes 03:00 AEDT (UTC+11).
  const aest = (d: number, hh: number, mm: number) => Date.UTC(2026, 9, d, hh, mm) - 10 * 3600_000;
  const aedt = (d: number, hh: number, mm: number) => Date.UTC(2026, 9, d, hh, mm) - 11 * 3600_000;

  it('keeps one line across the skipped hour: 01:55 → 03:00 is five minutes, not 65', () => {
    const segments = toSegments(
      [{ t: aest(4, 1, 55), level: -0.1 }, { t: aedt(4, 3, 0), level: -0.2 }, { t: aedt(4, 3, 30), level: -0.3 }],
      SYD,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].map(p => p.x)).toEqual([115, 180, 210]);
  });

  it('keeps one line where wall-clock minutes read 100 apart but only 40 passed: 01:40 → 03:20', () => {
    // 100 > GAP_MINUTES on the clock face, 40 in real time. This is the case the old code split.
    expect(toSegments([{ t: aest(4, 1, 40), level: -0.1 }, { t: aedt(4, 3, 20), level: -0.2 }], SYD)).toHaveLength(1);
  });

  it('still splits a real 90-minute gap on that day', () => {
    expect(toSegments([{ t: aedt(4, 10, 0), level: -0.1 }, { t: aedt(4, 11, 30), level: -0.2 }], SYD)).toHaveLength(2);
  });

  it('splits where the skipped hour hides a real gap: 01:00 → 03:30 is 90 minutes of silence', () => {
    expect(toSegments([{ t: aest(4, 1, 0), level: -0.1 }, { t: aedt(4, 3, 30), level: -0.2 }], SYD)).toHaveLength(2);
  });

  it('keeps one line over the repeated hour on 2027-04-04, in real time order', () => {
    // 03:00 AEDT (UTC+11) falls back to 02:00 AEST (UTC+10): 02:10 happens twice.
    const first = Date.UTC(2027, 3, 3, 15, 10); // 02:10 AEDT
    const second = Date.UTC(2027, 3, 3, 16, 10); // 02:10 AEST, an hour later
    const segments = toSegments([{ t: second, level: -0.2 }, { t: first, level: -0.1 }], SYD);
    expect(segments).toHaveLength(1);
    expect(segments[0].map(p => p.level)).toEqual([-0.1, -0.2]);
  });

  it('does not count the skipped hour as measured: four contiguous buckets either side of it are 2 h', () => {
    const segments = toSegments(
      [aest(4, 1, 15), aest(4, 1, 45), aedt(4, 3, 15), aedt(4, 3, 45)].map(t => ({ t, level: -0.1 })),
      SYD,
    );
    expect(segments).toHaveLength(1);
    const skip = clockSkipOnDay(dateStrMidnightInTz('2026-10-04', SYD).getTime(), SYD);
    expect(skip).toEqual({ fromMin: 120, toMin: 180 });
    expect(coveredMinutes(segments, skip)).toBe(120);
  });

  it('leaves a run that ends before the skipped hour alone', () => {
    const segments = toSegments([aest(4, 0, 15), aest(4, 0, 45)].map(t => ({ t, level: -0.1 })), SYD);
    const skip = clockSkipOnDay(dateStrMidnightInTz('2026-10-04', SYD).getTime(), SYD);
    expect(coveredMinutes(segments, skip)).toBe(60);
  });
});

describe('a day with no skipped hour', () => {
  it('measures the same with Brisbane\'s null skip as without one', () => {
    const skip = clockSkipOnDay(dateStrMidnightInTz('2026-10-04', TZ).getTime(), TZ);
    expect(skip).toBeNull();
    const segments = toSegments([at(1, 15, -0.1), at(1, 45, -0.1), at(3, 15, -0.1), at(3, 45, -0.1)], TZ);
    expect(coveredMinutes(segments, skip)).toBe(coveredMinutes(segments));
    expect(coveredMinutes(segments, skip)).toBe(60 + 60);
  });
});
