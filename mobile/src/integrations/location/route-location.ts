import type { LocationSource } from '../../features/activities/data/route-recording';

// The browser preview records time only; GPS routes are a phone feature.
export const routeLocation: LocationSource = {
  async watch(handlers) {
    handlers.problem('unavailable');
    return () => {};
  },
};
