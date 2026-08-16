import { describe, it, expect } from 'vitest';
import { isBleDataFresh, BLE_FRESHNESS_WINDOW_MS } from '../ble-freshness';

const HOUR = 60 * 60 * 1000;

describe('isBleDataFresh', () => {
  it('exposes a 48h window', () => {
    expect(BLE_FRESHNESS_WINDOW_MS).toBe(48 * HOUR);
  });

  it('is not fresh when there is no BLE data at all', () => {
    expect(isBleDataFresh(null, 100 * HOUR)).toBe(false);
  });

  it('is fresh when measured well within the window', () => {
    const now = 100 * HOUR;
    const measured = new Date(now - 10 * HOUR).toISOString();
    expect(isBleDataFresh(measured, now)).toBe(true);
  });

  it('is NOT fresh just past the window (48h1m elapsed)', () => {
    const now = 100 * HOUR;
    const measured = new Date(now - (48 * HOUR + 60_000)).toISOString();
    expect(isBleDataFresh(measured, now)).toBe(false);
  });

  it('is fresh at just under the window boundary (47h59m elapsed)', () => {
    const now = 100 * HOUR;
    const measured = new Date(now - (48 * HOUR - 60_000)).toISOString();
    expect(isBleDataFresh(measured, now)).toBe(true);
  });

  it('treats an unparsable timestamp as not fresh', () => {
    expect(isBleDataFresh('not-a-date', 100 * HOUR)).toBe(false);
  });
});
