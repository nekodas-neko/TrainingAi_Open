// Where a tap on a home-screen widget asks the app to go. It arrives from the native module
// (HomeWidgets.takeLaunchTarget), never as a URL: the sign-in callback handler treats any link on
// the app's scheme as a sign-in return while one is pending (#3268).

export type LaunchTarget =
  | { kind: 'home' }
  | { kind: 'workout' }
  | { kind: 'nutrition' }
  | { kind: 'session'; id: string };

export function parseLaunchTarget(raw: string | null | undefined): LaunchTarget | null {
  if (!raw) return null;
  if (raw === 'home' || raw === 'workout' || raw === 'nutrition') return { kind: raw };
  const prefix = 'next-session:';
  if (raw.startsWith(prefix) && raw.length > prefix.length) {
    return { kind: 'session', id: raw.slice(prefix.length) };
  }
  return null;
}
