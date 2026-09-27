import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../../../scripts/lib/strip-comments.js';

const src = stripComments(
  readFileSync(path.join(process.cwd(), 'components/health/day-detail/day-sections.tsx'), 'utf8'),
);

describe('RV-219 ② — the exercise name is the part that distinguishes the row', () => {
  // "Chest-Supported Dumbb…" cut exactly the words that tell it from every other row.
  it('wraps the name instead of truncating it', () => {
    const rows = src.split('\n').filter(l => l.includes('{ex.name}') || l.includes('flex-1 line-clamp-2'));
    expect(rows.length, 'the name row moved — re-read before changing this').toBeGreaterThan(0);
    const nameBlock = src.slice(src.indexOf('min-w-0 flex-1'), src.indexOf('{ex.name}</span>') + 20);
    expect(nameBlock).toMatch(/line-clamp-2/);
    expect(nameBlock, 'truncate cuts the distinguishing words').not.toMatch(/\btruncate\b/);
  });

  // The entry's other suggested fix was to shrink these. It is not available: 48 px is the Android
  // minimum touch target and this repo's tap-target floor, so shrinking trades a naming problem
  // for an accessibility one. Pinned so the trade is not made later by someone who has not read
  // the entry.
  it('keeps the icon buttons at the 48 px tap-target floor', () => {
    const iconBtn = src.slice(src.indexOf('const ICON_BTN'), src.indexOf('const ICON_BTN') + 220);
    expect(iconBtn).toMatch(/h-12 w-12/);
  });
});
