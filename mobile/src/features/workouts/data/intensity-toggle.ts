import { capitalize } from '@trainingai/shared/format/capitalize';
import { plural } from '@trainingai/shared/format/plural';

// The pre-workout screen's Full / Deload toggle and the prescription card under it (#3330, pick C).
// Flipping the toggle swaps the exercise list at once (`prepareSession`); this says, before the flip,
// what the other choice changes, and keeps the card's heading, reason and minutes on the session
// that will actually run. Every figure is the stored prescription's own: the full session's minutes
// are `fullSession` (`prescriptionFigures` on the server) and each exercise's full numbers are its
// `preDeloadStyle`, so nothing here re-derives the maths.

export type ToggleExercise = {
  name: string;
  deloaded: boolean;
  preDeloadStyle?: readonly unknown[] | null;
};

export type TogglePrescription = {
  deload?: boolean;
  phase: string;
  reasoning: string;
  estimatedSessionDurationMin: number;
  fullSession?: { estimatedSessionDurationMin: number } | null;
};

export type IntensityToggleInput = {
  prescription: TogglePrescription | null | undefined;
  /** The session as the server sent it, before Full puts any weights back. */
  exercises: readonly ToggleExercise[];
  /** The Deload side is chosen. */
  deloadChosen: boolean;
  /** The daily check suggests rest or a lighter day (#3718). */
  suggestedToday: boolean;
};

export type IntensityToggleModel = {
  fullLabel: string;
  deloadLabel: string;
  /** One line under the toggle naming what the other side changes; null when it is not known yet. */
  difference: string | null;
  /** Exercises that stay deloaded under Full: no full numbers were recorded for them. */
  staysLight: string[];
  /** The prescription card, following the toggle; null with no prescription. */
  card: { heading: string; reason: string; minutes: number } | null;
};

function names(list: string[]) {
  return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

export function intensityToggleModel(input: IntensityToggleInput): IntensityToggleModel {
  const { prescription, exercises, deloadChosen, suggestedToday } = input;
  const prescribedDeload = !!prescription?.deload;
  const deloaded = exercises.filter((exercise) => exercise.deloaded);
  const revertible = deloaded.filter((exercise) => !!exercise.preDeloadStyle?.length);
  const staysLight = deloaded
    .filter((exercise) => !exercise.preDeloadStyle?.length)
    .map((exercise) => exercise.name);
  const fullMinutes = prescription?.fullSession?.estimatedSessionDurationMin;
  const minutesApart =
    prescribedDeload && prescription && fullMinutes != null
      ? Math.round(fullMinutes - prescription.estimatedSessionDurationMin)
      : 0;

  let difference: string | null = null;
  if (revertible.length > 0) {
    const count = plural(revertible.length, 'exercise', 'exercises');
    const time = (longer: boolean) =>
      minutesApart >= 1 ? ` and about ${minutesApart} min ${longer ? 'longer' : 'shorter'}` : '';
    if (deloadChosen) {
      difference = `Full is ${count} heavier${time(true)}.`;
      if (staysLight.length) {
        difference += ` ${names(staysLight)} ${staysLight.length === 1 ? 'stays' : 'stay'} light: no full numbers yet.`;
      }
    } else {
      difference = `Deload is ${count} lighter${time(false)}.`;
    }
  } else if (staysLight.length) {
    difference = `Full keeps ${names(staysLight)} light: no full numbers yet.`;
  } else if (!deloadChosen) {
    difference = 'Deload lightens the loads for this session only.';
  }

  const card = prescription
    ? {
        heading: deloadChosen
          ? 'Deload session'
          : prescribedDeload
            ? 'Full session'
            : capitalize(prescription.phase),
        reason:
          deloadChosen === prescribedDeload
            ? prescription.reasoning
            : deloadChosen
              ? 'Lighter loads today, in place of the prescribed session.'
              : 'The deload is skipped today: this runs your full numbers.',
        minutes: Math.round(
          !deloadChosen && prescribedDeload && fullMinutes != null
            ? fullMinutes
            : prescription.estimatedSessionDurationMin,
        ),
      }
    : null;

  return {
    fullLabel: `Full${prescribedDeload ? ' · Override' : ' · As prescribed'}`,
    deloadLabel: `Deload${prescribedDeload ? ' · As prescribed' : suggestedToday ? ' · Suggested today' : ' · Lighter loads'}`,
    difference,
    staysLight,
    card,
  };
}
