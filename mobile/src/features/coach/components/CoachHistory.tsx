import { useRef, useState } from 'react';
import {
  AppButton,
  AppText,
  ListRow,
  Section,
  Skeleton,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useCoach } from '../CoachProvider';
import { coachError, historySpec, when, type LocalThread } from '../data/models';
export function CoachHistory({
  onOpen,
  onNew,
  opening,
  localThreads = [],
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
  opening: boolean;
  localThreads?: LocalThread[];
}) {
  const coach = useCoach(),
    history = useWorkoutResource(historySpec);
  const [undoing, setUndoing] = useState<string | null>(null),
    [refusal, setRefusal] = useState<Record<string, string>>({});
  const guard = useRef(false);
  const [closed, setClosed] = useState<string[]>([]);
  const timezone =
    history.resources?.connection.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const local = localThreads.filter(
    (thread) => !history.data?.threads.some((remote) => remote.id === thread.frame.threadId),
  );
  async function undo(id: string) {
    if (guard.current || !coach) return;
    guard.current = true;
    setUndoing(id);
    setRefusal((state) =>
      Object.fromEntries(Object.entries(state).filter(([key]) => key !== id)),
    );
    try {
      await coach.actions.undo(id);
    } catch (error) {
      if ((error as { status?: number })?.status === 409) setClosed((ids) => [...ids, id]);
      setRefusal((state) => ({
        ...state,
        [id]:
          (error as { status?: number })?.status === 409
            ? 'This change can no longer be undone because your training or settings have moved on.'
            : coachError(error, 'undo this change'),
      }));
    } finally {
      guard.current = false;
      setUndoing(null);
    }
  }
  return (
    <Stack gap="lg">
      <StatusIndicator
        label="Coach history"
        busy={history.loading || history.refreshing || opening}
        error={history.error}
        onRetry={history.refresh}
      />
      {history.loading && !history.data && <Skeleton style={{ height: 200 }} />}
      {!!history.data?.changes.length && (
        <Section title="Changes you’ve made">
          {history.data.changes.map((c) => (
            <Stack key={c.id}>
              <ListRow
                title={c.summary}
                subtitle={`${when(c.appliedAt, timezone)}${c.undoneAt ? ' · undone' : ''}`}
                trailing={
                  !c.undoneAt && !closed.includes(c.id) ? (
                    <AppButton
                      title={refusal[c.id] ? 'Retry undo' : 'Undo'}
                      variant="ghost"
                      busy={undoing === c.id}
                      disabled={!!undoing || opening}
                      onPress={() => {
                        void undo(c.id);
                      }}
                    />
                  ) : undefined
                }
              />
              {refusal[c.id] && (
                <AppText variant="caption" tone="muted">
                  {refusal[c.id]}
                </AppText>
              )}
            </Stack>
          ))}
        </Section>
      )}
      {!!history.data?.threads.length && (
        <Section title="Recent conversations">
          {history.data.threads.map((t) => (
            <ListRow
              key={t.id}
              title={t.title || 'Untitled'}
              subtitle={`${when(t.updatedAt, timezone)} · ${t.messageCount} messages`}
              onPress={!opening ? () => onOpen(t.id) : undefined}
            />
          ))}
        </Section>
      )}
      {!!local.length && (
        <Section title="Saved on this phone">
          {local.map((thread) => (
            <ListRow
              key={thread.id}
              title={thread.title}
              subtitle={when(thread.updatedAt, timezone)}
              onPress={!opening ? () => onOpen(thread.id) : undefined}
            />
          ))}
        </Section>
      )}
      {history.data &&
        !history.data.changes.length &&
        !history.data.threads.length &&
        !local.length && <AppText tone="muted">Nothing here yet.</AppText>}
      <AppButton title="New conversation" disabled={opening} onPress={onNew} />
    </Stack>
  );
}
