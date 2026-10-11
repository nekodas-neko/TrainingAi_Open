import { View } from 'react-native';
import { AppText, Card, CompletionStamp, MuscleMap, Stack } from '../../../shared/ui';
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
}: {
  session: SessionPreview;
  catalog: WorkoutCatalog;
  timezone: string;
  openWorkout: (id: string) => void;
  openSession: (id: string) => void;
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
        <Stack direction="row" align="center" style={{ flex: 1, minWidth: 0 }}>
          <SessionGlyph icon={session.icon} position={session.position} />
          <View style={{ flex: 1, gap: theme.spacing.xxs }}>
            <AppText variant="pageTitle" numberOfLines={1} style={{ color: palette.foreground }}>
              {session.name}
            </AppText>
            {session.id === catalog.recommendation.sessionId && (
              <View
                style={{
                  alignSelf: 'flex-start',
                  backgroundColor: theme.colors.brand,
                  borderRadius: theme.radii.pill,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.xxs,
                }}
              >
                <AppText variant="micro" style={{ color: theme.colors.onBrand }}>
                  Recommended today
                </AppText>
              </View>
            )}
            {!completed && (
              <AppText variant="caption" tone="muted">
                {lastTrained}
              </AppText>
            )}
            {(session.phaseDetail ?? session.phase) && (
              <AppText variant="caption" tone="muted">
                {session.phaseDetail ?? session.phase}
              </AppText>
            )}
          </View>
        </Stack>
        <View style={{ alignItems: 'flex-end' }}>
          <AppText variant="caption" tone="muted">
            {session.exercises.length} exercises
          </AppText>
          {session.durationMinutes !== null && (
            <AppText variant="caption" tone="muted">
              ~{Math.round(session.durationMinutes)} min
            </AppText>
          )}
        </View>
      </Stack>
      <View style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <MuscleMap assignments={assignments} />
        {completed && <CompletionStamp />}
      </View>
      <RecoveryRow muscles={recovery} />
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
