import type { HealthSnapshot } from './types';
export function sampleSnapshot(): HealthSnapshot {
  return {
    mode: 'sample', readAt: new Date().toISOString(), metrics: [
      { key: 'sleep', label: 'Sleep · last 36 hours', value: '7 h 30 min', detail: 'Example sleep duration; not your health data.', source: 'Fictional device' },
      { key: 'hr', label: 'Latest heart rate', value: '68 bpm', detail: 'Example individual reading.', source: 'Fictional device' },
      { key: 'rhr', label: 'Latest resting heart rate', value: '56 bpm', detail: 'Example individual reading.', source: 'Fictional device' },
      { key: 'steps', label: 'Latest steps interval', value: '240 steps', detail: 'One recorded interval, not a daily total.', source: 'Fictional device' },
      { key: 'energy', label: 'Latest active energy interval', value: '18 kcal', detail: 'One recorded interval, not a daily total.', source: 'Fictional device' },
    ],
  };
}
