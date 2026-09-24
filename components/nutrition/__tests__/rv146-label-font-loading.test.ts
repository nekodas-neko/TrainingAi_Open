import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
/** Comments are stripped first: both fixes explain themselves by quoting the shape they replaced. */
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (rel: string) => code(readFileSync(path.join(ROOT, rel), 'utf8'));

/**
 * RV-146 — two faces only the printable meal label uses were preloaded on every page, and the
 * browser logged "preloaded but not used" four times per visit.
 *
 * The entry's fix was `preload: false` alone, on the grounds that the renderer already awaits
 * `document.fonts.ready`. **Measured in Chromium on 2026-09-24, that fix alone would have shipped a
 * silent fallback.** `fonts.ready` settles PENDING loads; it does not start one. Nothing on the page
 * renders in these faces, so with the preload gone the browser never begins the fetch:
 *
 *   after `await document.fonts.ready`      check('700 12px "Archivo"') === false
 *   after `await document.fonts.load(...)`  check('700 12px "Archivo"') === true, 1 face loaded
 *
 * Canvas takes an unavailable face without complaint, so the label would have drawn in the generic
 * fallback and nothing would have said so. The two halves — no preload, explicit load — are one
 * guarantee, which is why they are pinned together here.
 *
 * The same probe turned up a second, older defect in the same function: `resolveFamily` read the
 * variables off `document.documentElement`, and `app/layout.tsx` sets them on the BODY class. A
 * custom property inherits downward only, so on <html> all four resolved to '' and every style fell
 * through to `sans-serif`/`serif`. The label had never drawn in any of its four typefaces.
 */
describe('RV-146 — the label faces are fetched on demand, and read off the element that has them', () => {
  const render = src('components/nutrition/meal-label-render.ts');
  const layout = src('app/layout.tsx');

  it('the two label-only faces are not preloaded', () => {
    // Both blocks carry `preload: false`; Geist and Geist Mono deliberately do not.
    const archivo = /const archivo = Archivo\(\{[^}]*\}\)/.exec(layout)?.[0] ?? '';
    const serif = /const instrumentSerif = Instrument_Serif\(\{[^}]*\}\)/.exec(layout)?.[0] ?? '';
    expect(archivo).toMatch(/preload:\s*false/);
    expect(serif).toMatch(/preload:\s*false/);

    const geist = /const geistSans = Geist\(\{[^}]*\}\)/.exec(layout)?.[0] ?? '';
    expect(geist, 'Geist is used by the app shell — preloading it is correct').not.toMatch(/preload:\s*false/);
  });

  it('the renderer asks for the face before it waits for readiness', () => {
    const loadAt = render.indexOf('document.fonts.load');
    const readyAt = render.indexOf('await document.fonts.ready');
    expect(loadAt, 'the renderer must start the load itself — `ready` will not').toBeGreaterThan(-1);
    expect(readyAt).toBeGreaterThan(-1);
    expect(loadAt, '`load` must come before `ready`, or `ready` settles against an empty set').toBeLessThan(readyAt);
  });

  it('every weight the renderer draws with is one it asked for', () => {
    const declared = /const DRAWN_WEIGHTS = \[([^\]]*)\]/.exec(render)?.[1] ?? '';
    const asked = new Set(Array.from(declared.matchAll(/'(\d+)'/g), m => m[1]));
    const drawn = new Set(Array.from(render.matchAll(/ctx\.font = `(\d+) /g), m => m[1]));
    expect(drawn.size, 'the renderer sets ctx.font somewhere').toBeGreaterThan(0);
    for (const w of drawn) expect(asked, `weight ${w} is drawn but never loaded`).toContain(w);
  });

  it('the family is read off the element that carries the variables', () => {
    expect(render).toMatch(/getComputedStyle\(document\.body\)\.getPropertyValue/);
    expect(render, 'the variables live on the body class, so <html> resolves empty')
      .not.toMatch(/getComputedStyle\(document\.documentElement\)/);
  });
});
