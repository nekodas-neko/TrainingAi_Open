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
