import { AppText, Card, Disclosure, IconButton, Stack } from '../../shared/ui';
import { useTheme } from '../../shared/theme/ThemeProvider';
import type { SavedProgram } from '../workouts/data/models';

export function ProgramCard({
  program,
  pending,
  busy,
  onEdit,
  onActivate,
  onDelete,
  onReview,
}: {
  program: SavedProgram;
  pending: boolean;
  busy: boolean;
  onEdit: () => void;
  onActivate: () => void;
  onDelete: () => void;
  onReview: (sessionId: string) => void;
}) {
  const { theme } = useTheme();
  const approach =
    program.phaseMode === 'ai_dynamic'
      ? 'AI training'
      : program.phaseMode === 'automatic'
        ? 'Phase based'
        : 'Linear';
  return (
    <Card tone={program.isActive ? 'brand' : 'neutral'} style={{ padding: theme.spacing.sm }}>
      <Disclosure
        compact
        title={program.name}
        subtitle={[
          program.isActive ? 'Active' : null,
          approach,
          `${program.sessions.length} ${program.sessions.length === 1 ? 'session' : 'sessions'}`,
          pending ? 'Upload pending' : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        trailing={
          <Stack direction="row" gap="xs">
            {!program.isActive && (
              <IconButton
                icon="check"
                label={`Set ${program.name} as active`}
                disabled={busy}
                onPress={onActivate}
              />
            )}
            <IconButton
              icon="edit"
              label={`Edit ${program.name}`}
              disabled={busy}
              onPress={onEdit}
            />
            {/* The delete is behind a confirmation in ProgramsScreen; this only asks for it. */}
            <IconButton
              icon="delete"
              label={`Delete ${program.name}`}
              tone="danger"
              disabled={busy}
              onPress={onDelete}
            />
          </Stack>
        }
      >
        <Stack style={{ padding: theme.spacing.sm }}>
          {program.sessions.map((session) => (
            <Stack key={session.id} gap="xs" style={{ paddingVertical: theme.spacing.sm }}>
              <Stack direction="row" align="center">
                <AppText variant="label" style={{ flex: 1 }}>
                  {session.name}
                </AppText>
                {program.isActive && program.phaseMode === 'ai_dynamic' && (
                  <IconButton
                    icon="forward"
                    label={`Review ${session.name}`}
                    onPress={() => onReview(session.id!)}
                  />
                )}
              </Stack>
              <AppText variant="caption" tone="muted" numberOfLines={2}>
                {session.exercises?.map((exercise) => exercise.exerciseName).join(', ') ||
                  'No exercises'}
              </AppText>
            </Stack>
          ))}
        </Stack>
      </Disclosure>
    </Card>
  );
}
