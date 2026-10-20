// What a manual night, steps or weight entry expires (HealthStore's saveNight, removeNight and
// logMetric call back once their write is queued; imports do not). `/api/collection` is there
// because those entries feed the Health ladder, as the web's sleep and body writes expire it.
export const manualHealthWritePaths = [
  '/api/readiness-score',
  '/api/body-battery',
  '/api/health/trends',
  '/api/health-trends',
  '/api/nutrition/energy-balance',
  '/api/progress-summary',
  '/api/day-log',
  '/api/day-checkin',
  '/api/day-timeline',
  '/api/sleep-verdict',
  '/api/next-session/prescription',
  '/api/workout-data',
  '/api/ai/health-insight',
  '/api/collection',
];
