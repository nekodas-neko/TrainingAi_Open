export const healthReadPaths = [
  '/api/day-timeline',
  '/api/body-metadata',
  '/api/sleep-sessions',
  '/api/readiness-score',
  '/api/body-battery',
  '/api/health/trends',
  '/api/health-trends',
  '/api/progress-summary',
  '/api/nutrition/energy-balance',
  '/api/training-load',
  '/api/training-stress',
  '/api/hr-profile',
  '/api/cardio-week',
  '/api/zone-minutes',
  '/api/weekly-muscle-sets',
  '/api/muscle-sets',
  '/api/sleep-performance-correlation',
  '/api/weekly-digest',
  '/api/weekly-review/month-window',
  '/api/activity-logs',
  '/api/weights-summary',
  '/api/muscle-recovery',
];

/**
 * #3667: what a night arriving after Home loaded changes. Every health read, plus the morning's sleep
 * verdict and the day log, which Home reads before last night exists.
 */
export const nightLandedPaths = [...healthReadPaths, '/api/sleep-verdict', '/api/day-log'];
