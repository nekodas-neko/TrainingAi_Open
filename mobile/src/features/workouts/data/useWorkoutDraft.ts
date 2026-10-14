import { useEffect, useState } from 'react';
import type { ZodType } from 'zod';
import { useWorkoutResources } from './WorkoutDataProvider';

export function useWorkoutDraft<T>(key: string, schema: ZodType<T>, initial: T) {
  const resources = useWorkoutResources();
  const [value, setValue] = useState(initial);
  const [ready, setReady] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const identity = resources
    ? `${resources.connection.origin}:${resources.connection.userId}`
    : '';
  const scopeKey = JSON.stringify([identity, key]);
  const activeReady = ready && loadedKey === scopeKey;
  useEffect(() => {
    let current = true;
    setReady(false);
    setLoadedKey(null);
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
          setLoadedKey(scopeKey);
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
    if (activeReady && resources) {
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
  }, [activeReady, value, identity, key]);
  return {
    value: loadedKey === scopeKey ? value : initial,
    setValue,
    ready: activeReady,
    error,
    resources,
  };
}
