import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * BF-116. The owner: *"the grid and battery pill still intersect."* "Still" is the word that matters
 * — the cause was the previous fix. BF-96 gave the weather chip `whitespace-nowrap shrink-0`
 * correctly, Q-111's device chips carry the same pair, and the date already had it, so every item in
 * the row became unshrinkable and the shortfall crossed the action buttons instead of wrapping.
 *
 * The contract is CSS, so this reads the classes. It is a weak test of appearance and a strong test
 * of the two decisions that are easy to undo by accident.
 */
describe('the header meta row can absorb a shortfall', () => {
  const row = code(src('components/home/header-meta-row.tsx'));

  it('lets the date shrink and truncate — it is the item that gives', () => {
    expect(row).toMatch(/className="text-xs text-muted-foreground truncate min-w-0"/);
    // `shrink-0` on the date is what made the row unshrinkable; `truncate` supplies its own nowrap.
    expect(row).not.toMatch(/text-muted-foreground[^"]*shrink-0/);
  });

  it('clips inside the row so chips alone cannot reach the buttons', () => {
    expect(row).toMatch(/flex items-center gap-2 min-w-0 overflow-hidden/);
  });

  it('keeps the chips unshrinkable, because wrapping them is the bug BF-96 fixed', () => {
    expect(code(src('components/weather-chip.tsx'))).toMatch(/whitespace-nowrap shrink-0/);
    expect(code(src('components/device-battery-chip.tsx'))).toMatch(/whitespace-nowrap shrink-0/);
  });

  /**
   * BF-139. The owner: *"the pills in the top are a little cutoff. can we make them smaller to
   * fit?"* Measured at 412 dp rather than estimated: the left column is **224 px**, two separate
   * battery pills cost **150 px** of it, and the weather chip's daytime `· UV n` form is **113 px**
   * — 279 px against 224. The entry's own suggested lever, `px-2.5` → `px-2`, saves 12 px across
   * three pills; it clears the reported night case and leaves the daytime case 43 px over. Merging
   * the battery pills and moving the `%` into the accessible name is what closes the rest.
   *
   * These assertions are the arithmetic, not the appearance. Splitting the pill back into two, or
   * putting `%` back on the glass, re-opens the overflow — so both are pinned here rather than left
   * to be rediscovered from another screenshot.
   */
  describe('and the three-chip row fits the column it has (BF-139)', () => {
    const battery = code(src('components/device-battery-chip.tsx'));

    it('renders every device in ONE pill', () => {
      expect(battery).toMatch(/devices: DeviceBattery\[\]/);
      expect(battery).toMatch(/devices\.map\(device =>/);
      // One `rounded-full` container. A second would be a second pill, which is the 150 px shape.
      expect(battery.match(/rounded-full/g) ?? [], 'one pill, not one per device').toHaveLength(1);
    });

    it('draws the number without a % and keeps the % in the accessible name', () => {
      expect(battery).toMatch(/<span className="tabular-nums">\{percent\}<\/span>/);
      expect(battery, 'a drawn % costs 12 px a reading').not.toMatch(/\{percent\}%<\/span>/);
      expect(battery).toMatch(/battery \$\{percent\}%/);
    });

    it('dims a stale device rather than the whole pill', () => {
      // With two devices sharing a pill, dimming the container misreports the fresh one.
      expect(battery).toMatch(/stale \? 'opacity-50' : ''/);
      expect(battery.match(/opacity-50/g) ?? []).toHaveLength(1);
    });

    it('carries the padding trim on both pills', () => {
      expect(battery).toMatch(/rounded-full bg-muted\/60 px-2 py-1/);
      // Both the snapshot pill and the failure-state dash, which share the shape.
      const weather = code(src('components/weather-chip.tsx'));
      expect(weather.match(/rounded-full bg-muted\/60 px-2 py-1/g) ?? []).toHaveLength(2);
      expect(weather, 'px-2.5 is the width this entry bought back').not.toMatch(/px-2\.5/);
    });
  });

  it('keeps the chips lazy and the date eager, as the page had them', () => {
    // The chips fetch; the date does not. Making the whole row lazy would blank the header on first
    // paint, which is the instant-paint rule's worse outcome.
    expect(row).toMatch(/dynamic\(\(\) => import\('@\/components\/home\/header-chips'\)/);
    expect(row).toMatch(/ssr: false/);
    expect(row).toMatch(/formatInTimeZone\(new Date\(\), tz, 'EEEE d MMMM'\)/);
  });

  it('and the page no longer owns the row', () => {
    const page = code(src('app/session-select/session-select-content.tsx'));
    expect(page).toMatch(/<HeaderMetaRow tz=\{tz\} \/>/);
    expect(page, 'the row moved out of the shrink-only hotspot').not.toMatch(/<HeaderChips \/>/);
  });
});
