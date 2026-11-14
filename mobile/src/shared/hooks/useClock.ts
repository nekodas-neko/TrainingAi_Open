import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useClock(enabled = true) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let interval: ReturnType<typeof setInterval> | null = null;
    function update() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      setNow(Date.now());
      if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') {
        interval = setInterval(() => setNow(Date.now()), 1000);
      }
    }
    update();
    const listener = AppState.addEventListener('change', update);
    return () => {
      if (interval) {
        clearInterval(interval);
      }
      listener.remove();
    };
  }, [enabled]);
  return now;
}

export { formatDuration } from './format-duration';
