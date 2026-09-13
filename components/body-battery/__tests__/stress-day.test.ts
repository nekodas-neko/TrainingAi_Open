import { describe, expect, it } from 'vitest';
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
