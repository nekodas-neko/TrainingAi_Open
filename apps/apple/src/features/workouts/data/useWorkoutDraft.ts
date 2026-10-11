import { useEffect, useState } from 'react';
import type { ZodType } from 'zod';
import { useWorkoutResources } from './WorkoutDataProvider';

export function useWorkoutDraft<T>(key: string, schema: ZodType<T>, initial: T) {
  const resources = useWorkoutResources();
  const [value, setValue] = useState(initial);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const identity = resources ? `${resources.connection.origin}:${resources.connection.userId}` : '';
  useEffect(() => {
    let current = true;
    setReady(false);
    setError(null);
    setValue(initial);
    if (!resources) {
      return;
    }
    void resources
      .draft(key, schema)
      .then((saved) => {
        if (current) {
          if (saved) {
            setValue(saved);
          }
          setReady(true);
        }
      })
      .catch(() => {
        if (current) {
          setError('Could not read the saved draft. Close and reopen this editor to retry.');
        }
      });
    return () => {
      current = false;
    };
  }, [identity, key]);
  useEffect(() => {
    if (ready && resources) {
      let current = true;
      void resources.saveDraft(key, value).catch(() => {
        if (current) {
          setError('Could not save this draft on the phone. Keep the editor open and retry.');
        }
      });
      return () => {
        current = false;
      };
    }
  }, [ready, value, identity, key]);
  return { value, setValue, ready, error, resources };
}
