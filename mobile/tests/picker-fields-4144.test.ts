import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { todayInTz } from '@trainingai/shared/date-utils';
import {
  calendarMonth,
  dateInBounds,
  formatDateField,
  formatTimeField,
  parseDateValue,
  parseTimeValue,
  shiftTime,
  toTimeValue,
} from '../src/shared/ui/pickerModel.ts';

// #4144: the date and time fields store exactly what the typed fields stored.

test('a date round-trips: stored YYYY-MM-DD shows as "24 Nov 2026" and is stored back unchanged', () => {
  for (const stored of ['2026-11-24', '2024-02-29', '2000-01-01', '2100-12-31']) {
    assert.equal(parseDateValue(stored), stored);
    // Picking the shown day from the calendar hands back the same `YYYY-MM-DD` string.
    assert.equal(parseDateValue(parseDateValue(stored)), stored);
  }
  assert.equal(formatDateField('2026-11-24'), '24 Nov 2026');
  assert.equal(formatDateField('2026-09-05'), '5 Sep 2026');
  assert.equal(formatDateField('2026/11/24'), '24 Nov 2026');
});

test('a date that is not a real day, or is empty, is not read as one', () => {
  for (const bad of ['', '  ', '2026-02-30', '2026-13-01', '2026-11-3', '24/11/2026', 'soon', '1999-12-31', '2101-01-01']) {
    assert.equal(parseDateValue(bad), null, bad);
    assert.equal(formatDateField(bad), null, bad);
  }
  assert.equal(parseDateValue(null), null);
  assert.equal(parseDateValue(undefined), null);
});

test('bounds are inclusive, and a missing bound is open', () => {
  assert.equal(dateInBounds('2026-11-24', '2026-11-24', '2026-11-24'), true);
  assert.equal(dateInBounds('2026-11-23', '2026-11-24'), false);
  assert.equal(dateInBounds('2026-11-25', undefined, '2026-11-24'), false);
  assert.equal(dateInBounds('2031-01-01'), true);
});

test('the calendar opens on the value\'s month, else on today\'s', () => {
  assert.equal(calendarMonth('2026-03-09', '2026-11-24'), '2026-03');
  assert.equal(calendarMonth('', '2026-11-24'), '2026-11');
  assert.equal(calendarMonth('garbage', '2026-11-24'), '2026-11');
});

test('"today" is the day in the profile\'s zone, not the device\'s or UTC', () => {
  mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 24, 14, 30) });
  try {
    // 14:30 UTC: already the 25th in Auckland, still the 24th in Los Angeles.
    assert.equal(todayInTz('Pacific/Auckland'), '2026-11-25');
    assert.equal(todayInTz('America/Los_Angeles'), '2026-11-24');
    assert.equal(calendarMonth('', todayInTz('Pacific/Auckland')), '2026-11');
    // Across a month end the zones disagree on the month the empty field opens on.
    mock.timers.reset();
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 30, 14, 30) });
    assert.equal(calendarMonth('', todayInTz('Pacific/Auckland')), '2026-12');
    assert.equal(calendarMonth('', todayInTz('America/Los_Angeles')), '2026-11');
  } finally {
    mock.timers.reset();
  }
});

test('a time round-trips: HH:MM stored, shown in the app\'s time form, stored back unchanged', () => {
  for (const stored of ['00:00', '06:40', '11:10', '12:00', '23:55', '23:59']) {
    const time = parseTimeValue(stored);
    assert.ok(time, stored);
    assert.equal(toTimeValue(time), stored);
  }
  // The typed field also took a bare hour digit; the stored form is always two digits.
  assert.equal(toTimeValue(parseTimeValue('7:05')!), '07:05');
  assert.equal(formatTimeField('23:10', 'Australia/Brisbane', '2026-11-24'), '11:10 pm');
  assert.equal(formatTimeField('06:40', 'Australia/Brisbane', '2026-11-24'), '6:40 am');
  assert.equal(formatTimeField('00:05', 'Australia/Brisbane', '2026-11-24'), '12:05 am');
  assert.equal(formatTimeField('12:00', 'Australia/Brisbane', '2026-11-24'), '12:00 pm');
});

test('a time outside the clock is not read as one', () => {
  for (const bad of ['', '24:00', '12:60', '9', '09:5', 'noon', '9:30pm']) {
    assert.equal(parseTimeValue(bad), null, bad);
    assert.equal(formatTimeField(bad, 'Australia/Brisbane', '2026-11-24'), null, bad);
  }
});

test('the exact-minute buttons move one minute and wrap the day', () => {
  assert.deepEqual(shiftTime({ hour: 6, minute: 40 }, 1), { hour: 6, minute: 41 });
  assert.deepEqual(shiftTime({ hour: 6, minute: 59 }, 1), { hour: 7, minute: 0 });
  assert.deepEqual(shiftTime({ hour: 0, minute: 0 }, -1), { hour: 23, minute: 59 });
  assert.deepEqual(shiftTime({ hour: 23, minute: 59 }, 1), { hour: 0, minute: 0 });
  assert.equal(toTimeValue(shiftTime({ hour: 6, minute: 5 }, -6)), '05:59');
});

test('a wall time a clock change skips still reads, and the zone is the profile\'s', () => {
  // Sydney springs forward on 2026-10-04: 02:30 does not exist that day. It still shows as a time.
  assert.equal(formatTimeField('02:30', 'Australia/Sydney', '2026-10-04'), '2:30 am');
  // The same stored wall time reads the same in any zone: the zone only decides which day it is.
  assert.equal(formatTimeField('17:00', 'America/Los_Angeles', '2026-11-24'), '5:00 pm');
});
