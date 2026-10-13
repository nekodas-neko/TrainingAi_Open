import { View } from 'react-native';
import {
  AppText,
  Card,
  CompletionStamp,
  MuscleMap,
  Stack,
  Badge,
  Icon,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import type { SessionPreview, WorkoutCatalog } from '../catalog';
import { sessionTrainingStatus } from '../catalog';
import { SessionGlyph } from './SessionGlyph';
import { RecoveryRow } from './RecoveryRow';
import { StartWorkoutCard } from './StartWorkoutCard';

export function SessionSelectionCard({
  session,
  catalog,
  timezone,
  openWorkout,
  openSession,
  active = true,
}: {
  session: SessionPreview;
  catalog: WorkoutCatalog;
  timezone: string;
  openWorkout: (id: string) => void;
  openSession: (id: string) => void;
  active?: boolean;
}) {
  const { theme } = useTheme();
  const journal = useWorkoutJournal();
  const palette = theme.sessions[session.position % theme.sessions.length];
  const completedDates = journal.data.workouts
    .filter((workout) => workout.sessionId === session.id && workout.status === 'completed')
    .map((workout) => workout.date);
  const { completed, lastTrained } = sessionTrainingStatus(session, completedDates, timezone);
  const assignments =
    session.muscleActivations ??
    [...new Set(session.exercises.flatMap((exercise) => exercise.muscles))].map((muscle) => ({
      muscle,
      role: 'main' as const,
    }));
  const mainMuscles = new Set(
    assignments
      .filter((assignment) => assignment.role === 'main')
      .map((assignment) => assignment.muscle),
  );
  const recovery = (catalog.recovery ?? []).filter((item) => mainMuscles.has(item.muscle));
  return (
    <Card
      style={{
        flex: 1,
        minHeight: 0,
        backgroundColor: palette.background,
        borderColor: completed ? theme.anatomy.main : palette.border,
      }}
    >
      <Stack direction="row" align="center" justify="space-between">
        <SessionGlyph icon={session.icon} position={session.position} />
        <Stack gap="xxs" style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="title" numberOfLines={2} style={{ color: palette.foreground }}>
            {session.name}
          </AppText>
          {(session.phaseDetail ?? session.phase) && (
            <AppText variant="caption" tone="muted">
              {session.phaseDetail ?? session.phase}
            </AppText>
          )}
        </Stack>
        {session.id === catalog.recommendation.sessionId && (
          <Badge label="Today" tone="brand" />
        )}
      </Stack>
      <Stack direction="row" align="center" gap="lg" wrap>
        <Stack direction="row" align="center" gap="xs">
          <Icon name="workout" tone="muted" size={theme.sizes.iconSmall} />
          <AppText variant="caption" tone="muted">
            {session.exercises.length} exercises
          </AppText>
        </Stack>
        {session.durationMinutes !== null && (
          <Stack direction="row" align="center" gap="xs">
            <Icon name="timer" tone="muted" size={theme.sizes.iconSmall} />
            <AppText variant="caption" tone="muted">
              ~{Math.round(session.durationMinutes)} min
            </AppText>
          </Stack>
        )}
      </Stack>
      {!completed && (
        <AppText variant="caption" tone="muted">
          {lastTrained}
        </AppText>
      )}
      <View style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <MuscleMap assignments={assignments} />
        {completed && <CompletionStamp />}
      </View>
      <RecoveryRow muscles={recovery} active={active} />
      <StartWorkoutCard
        session={session}
        programId={catalog.program!.id}
        openWorkout={openWorkout}
        inline
        completed={completed}
        onPrepare={() => openSession(session.id)}
      />
    </Card>
  );
}
