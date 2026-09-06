import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Comments explain the provenance constantly; strip them or a guard passes on its own prose. */
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * BF-114. The owner: *"the BMR in scale is different to home; should probably indicate the
 * difference?"* The Body tab carries TWO tiles both labelled `BMR`, from different formulas, and
 * neither said which was which.
 *
 * The entry's premise was wrong and this guard pins the corrected version: the scale card's BMR is
 * **not** a bioimpedance reading. `lib/scale-ble/composition.ts` computes it with Mifflin-St Jeor
 * from weight, height, age and sex — its own comment says *"independent of impedance"* — so a label
 * calling it a scale measurement would be false, and so was the card's popover.
 */
describe('both BMR tiles name where their number comes from', () => {
  const sections = code(src('app/health/health-sections.tsx'));

  it('the composition card says its BMR is calculated from lean mass', () => {
    expect(sections).toMatch(/calculated from lean mass/);
  });

  it('the scale card says its BMR comes from weight and height, not from the scale', () => {
    expect(sections).toMatch(/from weight & height/);
    // The label that would be wrong: "scale estimate" reads as a measurement the scale took.
    expect(sections, 'the scale does not measure this figure').not.toMatch(/label: "BMR"[^}]*note: "scale/);
  });

  it('the scale card carves BMR and visceral fat out of its impedance claim', () => {
    expect(sections).toMatch(/Mifflin-St Jeor equation and Visceral Fat is derived from BMI and age/);
    expect(sections).toMatch(/neither uses impedance/);
  });

  it('does not claim the targets ignore this BMR, only that they prefer a measured rate', () => {
    // The service falls back to the SAME equation when no measured RMR exists, so "targets do not
    // use this BMR" is true of the stored value and misleading about the number.
    expect(sections).not.toMatch(/targets do not use this BMR/);
    expect(sections).toMatch(/prefer a clinically measured resting rate/);
  });

  it('the scale BMR really is impedance-free, which is what the labels rest on', () => {
    const comp = src('lib/scale-ble/composition.ts');
    expect(comp).toMatch(/Mifflin-St Jeor/);
    expect(comp).toMatch(/const bmrKcal = Math\.round\(10 \* weightKg \+ 6\.25 \* heightCm - 5 \* ageYears \+ sexTerm\)/);
  });

  it('and the energy model never reads the stored scale BMR', () => {
    // If this ever changes, "prefer a clinically measured resting rate" stops being the whole story.
    const service = code(src('lib/health/energy-balance-service.ts'));
    expect(service).not.toMatch(/metrics[^\n]*\.bmrKcal/);
  });
});
