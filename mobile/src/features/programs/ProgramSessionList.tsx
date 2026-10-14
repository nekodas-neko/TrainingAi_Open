import { randomUUID } from 'expo-crypto';
import { useEffect, useMemo } from 'react';
import { SortableStack } from '../../shared/ui';
import type { LibraryExercise, SavedStyle } from '../workouts/data/models';
import type { ProgramDraft } from './editor-model';
import { identifyProgramDraft, reorderSessions } from './reorder-model';
import { SessionEditor } from './SessionEditor';

export function ProgramSessionList({
  draft,
  onChange,
  library,
  styles,
  removable = false,
  disabled = false,
}: {
  draft: ProgramDraft;
  onChange: (draft: ProgramDraft) => void;
  library: LibraryExercise[];
  styles: SavedStyle[];
  removable?: boolean;
  disabled?: boolean;
}) {
  const value = useMemo(() => identifyProgramDraft(draft, randomUUID), [draft]);
  useEffect(() => {
    if (value !== draft) onChange(value);
  }, [value, draft, onChange]);
  return (
    <SortableStack
      order={value.sessions.map((session) => session.id!)}
      enabled={!disabled}
      label={(id) => value.sessions.find((session) => session.id === id)?.name || 'Session'}
      onChange={(order) => onChange(reorderSessions(value, order))}
      renderItem={(id, handle) => {
        const index = value.sessions.findIndex((session) => session.id === id);
        return (
          <SessionEditor
            draft={value}
            index={index}
            onChange={onChange}
            library={library}
            styles={styles}
            handle={handle}
            disabled={disabled}
            onRemove={
              removable
                ? () =>
                    onChange({
                      ...value,
                      sessions: value.sessions.filter((session) => session.id !== id),
                    })
                : undefined
            }
          />
        );
      }}
    />
  );
}
