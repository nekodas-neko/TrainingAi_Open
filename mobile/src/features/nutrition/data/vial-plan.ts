import {
  concentrationMgPerMl,
  unitsForMg,
  type Reconstitution,
} from '@trainingai/shared/health/vial-dose';
export const DEFAULT_BARREL_UNITS = 100;
export interface DosePlan {
  ml: number | null;
  units: number | null;
  concentration: number | null;
  dosesInVial: number | null;
  exceedsBarrel: boolean;
}
export function planDose(
  doseMg: number,
  vial: Reconstitution,
  barrelUnits: number = DEFAULT_BARREL_UNITS,
): DosePlan {
  const concentration = concentrationMgPerMl(vial);
  const units = unitsForMg(doseMg, vial);
  const ml =
    concentration == null || !Number.isFinite(doseMg) || doseMg < 0
      ? null
      : doseMg / concentration;
  const dosesInVial =
    concentration == null || !Number.isFinite(doseMg) || doseMg <= 0
      ? null
      : Math.floor(vial.strengthMg / doseMg);
  return {
    ml,
    units,
    concentration,
    dosesInVial,
    exceedsBarrel:
      units != null && Number.isFinite(barrelUnits) && barrelUnits > 0 && units > barrelUnits,
  };
}
export function concentrationWorking(vial: Reconstitution): string | null {
  const c = concentrationMgPerMl(vial);
  if (c == null) return null;
  return `${trim(vial.strengthMg)} mg ÷ ${trim(vial.waterMl)} mL = ${trim(c, 2)} mg/mL`;
}
export function doseWorking(doseMg: number, vial: Reconstitution): string | null {
  const plan = planDose(doseMg, vial);
  if (plan.concentration == null || plan.ml == null || plan.units == null) return null;
  return `${trim(doseMg, 2)} mg ÷ ${trim(plan.concentration, 2)} mg/mL = ${trim(plan.ml, 2)} mL → ${trim(plan.units)} units`;
}
function trim(n: number, maxDp = 2): string {
  return Number(n.toFixed(maxDp)).toString();
}
export function isMilligramDosed(s: { unit?: string | null }): boolean {
  return (s.unit ?? '').trim().toLowerCase() === 'mg';
}
