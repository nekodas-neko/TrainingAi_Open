import { buildEquipmentSet, equipmentEligible } from '@trainingai/shared/workout/equipment';
import type { LibraryExercise } from '../workouts/data/models';
export const exerciseEquipment = [
  'barbell',
  'dumbbell',
  'cable',
  'machine',
  'kettlebell',
  'bodyweight',
];
export const exerciseMuscles = [
  'Chest',
  'Shoulders',
  'Triceps',
  'Biceps',
  'Forearms',
  'Upper Back',
  'Lats',
  'Lower Back',
  'Traps',
  'Core',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Adductors',
];
export const muscleBuckets: Record<string, string[]> = {
  Chest: ['chest'],
  Back: ['upper back', 'lats', 'lower back'],
  Shoulders: ['shoulders'],
  Arms: ['biceps', 'triceps', 'forearms'],
  Legs: ['quads', 'hamstrings', 'calves'],
  Glutes: ['glutes'],
  Core: ['core', 'abs'],
  Traps: ['traps'],
};
export function exerciseChoices(
  library: LibraryExercise[],
  query: string,
  equipment: string,
  muscle: string,
) {
  return library.filter(
    (x) =>
      !x.mergedInto &&
      x.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (!equipment || x.equipment.some((y) => y.toLowerCase() === equipment)) &&
      (!muscle ||
        x.muscles.some((y) => muscleBuckets[muscle]?.includes(y.muscle.toLowerCase()))),
  );
}
export function exerciseAlternatives(
  library: LibraryExercise[],
  current: LibraryExercise,
  role: string | null | undefined,
  equipment: string[],
) {
  const owned = buildEquipmentSet(equipment);
  const main = new Set(current.muscles.filter((x) => x.role === 'main').map((x) => x.muscle));
  return library
    .filter(
      (x) =>
        !x.mergedInto &&
        x.id !== current.id &&
        equipmentEligible(x.equipment, owned) &&
        x.muscles.some((y) => y.role === 'main' && main.has(y.muscle)) &&
        (role !== 'primary' || x.muscles.length > 1),
    )
    .slice(0, 8);
}
