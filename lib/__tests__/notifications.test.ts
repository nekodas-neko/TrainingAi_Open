import { describe, it, expect } from 'vitest';
import { computeRestNotificationAction } from '../notifications';

describe('computeRestNotificationAction', () => {
  const NOW = 1_000_000;

  it('schedules when in rest phase with remaining time > 1s', () => {
    const result = computeRestNotificationAction(
      'rest',
      NOW - 5_000,   // restStartMs: 5s ago
      90,            // currentRestSec: 90s rest
      2,             // currentSet: 2 (next set = 3)
      NOW,
    );
    expect(result).toEqual({ action: 'schedule', delayMs: 85_000, setNumber: 3 });
  });

  it('cancels when remaining time <= 1s', () => {
    const result = computeRestNotificationAction(
      'rest',
      NOW - 89_500,  // restStartMs: 89.5s ago
      90,            // currentRestSec: 90s
      2,
      NOW,
    );
    expect(result).toEqual({ action: 'cancel' });
  });

  it('cancels when not in rest phase', () => {
    expect(computeRestNotificationAction('set', NOW, 90, 1, NOW)).toEqual({ action: 'cancel' });
    expect(computeRestNotificationAction('pre', NOW, 90, 1, NOW)).toEqual({ action: 'cancel' });
  });

  it('cancels when restStartMs is null', () => {
    expect(computeRestNotificationAction('rest', null, 90, 1, NOW)).toEqual({ action: 'cancel' });
  });

  it('cancels when currentRestSec is 0', () => {
    expect(computeRestNotificationAction('rest', NOW, 0, 1, NOW)).toEqual({ action: 'cancel' });
  });
});
