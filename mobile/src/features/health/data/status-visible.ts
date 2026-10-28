// The refresh status (a spinner while loading, a retry icon after an error) takes a 48 px slot even
// when it draws nothing. The current app's card headers have no such slot, so a header that wants
// its natural height and its controls flush right draws the status only while it has something to say.
export function statusVisible(state: {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  connected?: boolean;
}) {
  return state.loading || state.refreshing || !!state.error || state.connected === false;
}
