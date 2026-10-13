import { useState } from 'react';
import { ActionMenu, AppText, Card, Disclosure, IconButton, Stack } from '../../shared/ui';
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
  const [menu, setMenu] = useState(false);
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
            <IconButton
              icon="edit"
              label={`Edit ${program.name}`}
              disabled={busy}
              onPress={onEdit}
            />
            <IconButton
              icon="more"
              label={`Options for ${program.name}`}
              disabled={busy}
              onPress={() => setMenu(true)}
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
      <ActionMenu
        visible={menu}
        title={program.name}
        onClose={() => setMenu(false)}
        actions={[
          { title: 'Edit program', icon: 'edit', run: onEdit },
          ...(!program.isActive
            ? [{ title: 'Set as active', icon: 'check' as const, run: onActivate }]
            : []),
          { title: 'Delete program', icon: 'delete', danger: true, run: onDelete },
        ]}
      />
    </Card>
  );
}
