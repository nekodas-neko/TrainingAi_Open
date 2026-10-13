import { AppText, Badge, Stack } from '../../../shared/ui';
import { nextPrescriptionSpec } from '../data/models';
import { ResourceCard } from './ResourceCard';

export function NextPrescription() {
  return (
    <ResourceCard title="Next workout" spec={nextPrescriptionSpec}>
      {(data) =>
        data.isRestDay ? (
          <AppText>Next up: a rest day</AppText>
        ) : (
          <Stack>
            <AppText variant="label">{data.sessionName}</AppText>
            {data.source === 'pending' && (
              <AppText variant="micro" tone="muted">
                Your next prescription is still being prepared.
              </AppText>
            )}
            {data.exercises?.map((exercise) => (
              <Stack key={exercise.name} gap="xs">
                <AppText variant="caption">{exercise.name}</AppText>
                <Stack direction="row" wrap gap="xs">
                  {exercise.sets.map((set, index) => (
                    <Badge
                      key={index}
                      label={
                        set.weightKg === null ||
                        (exercise.exerciseType === 'bodyweight' && set.weightKg === 0)
                          ? `${set.reps} reps`
                          : `${set.weightKg} kg × ${set.reps}`
                      }
                    />
                  ))}
                </Stack>
              </Stack>
            ))}
          </Stack>
        )
      }
    </ResourceCard>
  );
}
