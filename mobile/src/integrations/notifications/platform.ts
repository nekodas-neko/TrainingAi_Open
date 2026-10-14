export const alertsAvailable = () => false;
export async function alertPermission(request = false) {
  if (request) throw new Error('Notifications require the native app.');
  return false;
}
export const nativeAlerts = {
  list: async () => [],
  cancel: async (_id: string) => {},
  schedule: async (_alert: import('../../features/platform/data/models').Alert) => {},
};
export async function observeAlerts(_onOpen: (data: Record<string, unknown>) => void) {
  return () => {};
}
