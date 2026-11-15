/**
 * When each main tab first has its data, for the start-up timings (#3774). `ready` is the saved
 * copy having finished opening; `hasData` is what the tab leads with being there.
 * Home leads with today's health summary and the day's session from the catalogue; Health with
 * the summary and sleep; Workout with the catalogue.
 */
export function startupTabStates(state: {
  homeReady: boolean;
  healthReady: boolean;
  body: boolean;
  sleep: boolean;
  catalogReady: boolean;
  catalog: boolean;
}) {
  return [
    {
      mark: 'home' as const,
      ready: state.homeReady && state.healthReady && state.catalogReady,
      hasData: state.body && state.catalog,
    },
    {
      mark: 'health' as const,
      ready: state.healthReady,
      hasData: state.body && state.sleep,
    },
    { mark: 'workout' as const, ready: state.catalogReady, hasData: state.catalog },
  ];
}
