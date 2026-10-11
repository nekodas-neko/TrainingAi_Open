import { useRef, useState } from 'react';
import { ApiError } from '../../account/api/client';

export function useWorkoutAction() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>, success?: string) {
    if (running.current) {
      return false;
    }
    running.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success ?? null);
      return true;
    } catch (error) {
      setError(
        error instanceof ApiError
          ? error.status === 403
            ? 'Your account cannot perform this action.'
            : error.status === 429
              ? 'Please wait a moment before trying again.'
              : error.status === 404
                ? 'This item is no longer available. Refresh and retry.'
                : 'Could not save this change. Your draft is kept on this phone; retry when connected.'
          : error instanceof Error
            ? error.message
            : 'Could not complete this action.',
      );
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return {
    busy,
    error,
    message,
    run,
    clear: () => {
      setError(null);
      setMessage(null);
    },
  };
}
