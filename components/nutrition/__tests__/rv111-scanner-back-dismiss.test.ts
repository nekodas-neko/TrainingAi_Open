import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const ROOT = path.resolve(__dirname, '../../..');
/**
 * The shared stripper, not the regex pair every other source-scan test in this repo copies.
 *
 * That pair treats the `/*` inside `accept="image/*"` as a comment opener and runs to the next
 * `*` + `/`, which in `capture-actions.tsx` silently deleted 15 KB — the `<BarcodeScanner` render
 * this file asserts on among it. It only surfaced because RV-203 added comments that moved the
 * pairing; before that it happened to land somewhere harmless. A guard reading a mangled file is
 * the LA-64 failure the stripper exists to prevent, so this uses `scripts/lib/strip-comments.js`,
 * which walks string literals properly. The other copies are swept in LB-160.
 */
const src = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));

/**
 * RV-111 — one hardware back while the barcode scanner was open threw away the whole Log Food flow.
 * Confirmed on the S25 (sweep 2): `body.scanner-active` was set, the app kept focus, and a single
 * press left no dialog at all.
 *
 * The scanner **replaces the sheet's body** instead of opening a surface of its own, so the only
 * thing the back listener could see was the Log Food sheet — `SheetContent` renders `BackDismiss`
 * once — and it popped that. Registering the scanner as a nested surface is the fix.
 *
 * **Why the stack logic itself is not re-tested here:** `sheet-back-stack.test.ts`'s LB-17 case
 * already proves that three layers unwind one press at a time, and the depth accounting is what
 * makes that true — popping the scanner's entry lands on the sheet's, so `arrivedDepth` is 1 and
 * only surfaces deeper than 1 close. What was missing was not the logic, it was these two call
 * sites, so that is what these assertions are on.
 *
 * That safety property is load-bearing rather than tidy: the scanner hides every other body child
 * with a global `body.scanner-active` rule that it only removes on unmount, so a press that closed
 * both surfaces at once would leave the app blank.
 */
describe('RV-111 — the barcode scanner is its own back surface', () => {
  const capture = src('components/nutrition/capture-actions.tsx');
  const picker = src('components/nutrition/ingredient-picker.tsx');

  it('both scanner hosts register the surface', () => {
    expect(capture).toMatch(/useSheetBackDismiss\(showBarcode, \(\) => setShowBarcode\(false\)\)/);
    expect(picker).toMatch(/useSheetBackDismiss\(scanning, \(\) => setScanning\(false\)\)/);
  });

  it('the hook is called before the early return that swaps the body, not inside it', () => {
    // Both files `return <BarcodeScanner …/>` when scanning. A hook placed after that return runs
    // conditionally, which React forbids outright and which would also never register the surface
    // on the render that opens it — the exact frame it is needed.
    for (const [name, s] of [['capture-actions', capture], ['ingredient-picker', picker]] as const) {
      const hookAt = s.indexOf('useSheetBackDismiss(');
      const returnAt = s.indexOf('<BarcodeScanner');
      expect(hookAt, `${name}: the hook call`).toBeGreaterThan(-1);
      expect(returnAt, `${name}: the scanner render`).toBeGreaterThan(-1);
      expect(hookAt, `${name}: hook must be unconditional`).toBeLessThan(returnAt);
    }
  });

  it('neither file hand-rolls its own back handling instead', () => {
    // The stack is module-level and depth-aware; a local popstate listener cannot see siblings and
    // is how BF-34's sheet-closes-as-dialog-opens bug happened.
    for (const s of [capture, picker]) {
      expect(s).not.toMatch(/addEventListener\(\s*'popstate'/);
      expect(s).not.toMatch(/history\.pushState/);
    }
  });
});
