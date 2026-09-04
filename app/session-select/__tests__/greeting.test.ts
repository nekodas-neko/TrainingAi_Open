import { describe, expect, it } from 'vitest';
import { getGreeting } from '../greeting';

const TZ = 'Australia/Brisbane';

// 2026-09-04 is a Friday; Brisbane is UTC+10 year-round, so local hour = UTC hour + 10.
const at = (localHour: number) =>
  new Date(Date.UTC(2026, 8, 4, (localHour - 10 + 24) % 24, 30));

describe('getGreeting', () => {
  it('names the person', () => {
    expect(getGreeting('Sam', TZ, at(9))).toBe('Good morning, Sam.');
  });

  // 00:00-11:59 is "morning" — pre-existing behaviour, pinned rather than endorsed. A resume at
  // 00:30 (the BF-117 window) therefore reads "Good morning", which is odd but harmless.
  it.each([
    [0, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [16, 'afternoon'],
    [17, 'evening'],
    [20, 'evening'],
    [21, 'night'],
    [23, 'night'],
  ])('at %i:30 local it is %s', (hour, period) => {
    expect(getGreeting('Sam', TZ, at(hour))).toBe(`Good ${period}, Sam.`);
  });

  it('reads the hour in the user timezone, not the runner one', () => {
    // 09:30 UTC is 19:30 in Brisbane. A runner reading its own clock would say "morning".
    const utcMorning = new Date(Date.UTC(2026, 8, 4, 9, 30));
    expect(getGreeting('Sam', TZ, utcMorning)).toBe('Good evening, Sam.');
    expect(getGreeting('Sam', 'UTC', utcMorning)).toBe('Good morning, Sam.');
  });
});
