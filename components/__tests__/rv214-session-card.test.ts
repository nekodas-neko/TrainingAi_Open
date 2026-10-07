import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.js';

const read = (p: string) => stripComments(readFileSync(path.join(process.cwd(), p), 'utf8'));

describe('RV-214 ① — a session icon is a component, not text', () => {
  // The scanner in scripts/check-session-icon-render.js holds this at zero across the tree; these
  // pin the sites that were wrong, so a revert names the file rather than just the count.
  it.each([
    ['app/workout-select/workout-select-content.tsx'],
    ['components/workout-builder/builder-review.tsx'],
  ])('%s renders SessionGlyph', (file) => {
    expect(read(file)).toMatch(/<SessionGlyph\s/);
  });

  it('SessionGlyph resolves through the existing map rather than a new one', () => {
    const src = read('components/session-glyph.tsx');
    expect(src).toMatch(/from ['"]@\/lib\/session-icon['"]/);
    expect(src).toMatch(/getSessionIcon\(icon, palettePosition\)/);
  });
});

describe('RV-214 ③ — "9 days ago" beside a calendar, on a card recommending today', () => {
  const src = read('app/workout-select/workout-select-content.tsx');

  // The ambiguity is not specific to "Yesterday": "9 days ago" reads just as easily as when the
  // session is next due. Both branches say what the number is about.
  it('both elapsed branches say what the elapsed time measures', () => {
    expect(src).toMatch(/return "Last done yesterday"/);
    expect(src).toMatch(/return `Last done \$\{days\} days ago`/);
  });

  // `trainedToday` compares against this exact string; renaming it silently breaks that branch.
  it('leaves the string the trainedToday check keys on', () => {
    expect(src).toMatch(/return "Trained today"/);
    expect(src).toMatch(/lastTrained === "Trained today"/);
  });
});

describe('RV-214 ④ — the recovery chips scroll out, they are not clipped', () => {
  it('the marquee fades at both ends', () => {
    const css = readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');
    const rule = css.slice(css.indexOf('.recovery-marquee {'));
    expect(rule.slice(0, 400)).toMatch(/mask-image:\s*linear-gradient\(to right, transparent/);
    // Both spellings: Samsung's WebView is the canonical runtime and takes the prefixed one.
    expect(rule.slice(0, 400)).toMatch(/-webkit-mask-image:/);
  });
});
