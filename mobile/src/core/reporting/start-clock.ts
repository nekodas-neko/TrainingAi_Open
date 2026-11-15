// Imported first by index.ts, so the reading below is taken as the bundle starts to run. Start-up
// timings (#3774) are measured from it on this clock; React Native's own markers cover the native
// part before it.
export const clock: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

export const jsStartedAt = clock();
