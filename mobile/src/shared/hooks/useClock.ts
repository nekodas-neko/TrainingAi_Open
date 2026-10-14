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

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
    : `${minutes}:${String(total % 60).padStart(2, '0')}`;
}
