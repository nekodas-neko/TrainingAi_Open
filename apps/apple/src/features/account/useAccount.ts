import { useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { AccountSession } from './session';
import type { AccountState } from './session';
import { authPlatform, nativeAuthAvailable, nativeAppleAuthAvailable } from '../../integrations/auth/platform';

export function useAccount() {
  const [setup] = useState(() => {
    const origin = process.env.EXPO_PUBLIC_API_URL;
    if (!origin) { return { controller: null, reason: 'Account sign-in is waiting for the backend connection.' }; }
    if (Platform.OS !== 'ios') { return { controller: null, reason: 'Account sign-in is available in the iPhone app.' }; }
    if (!nativeAuthAvailable()) { return { controller: null, reason: 'Install the new iPhone development build to enable sign-in.' }; }
    try { return { controller: new AccountSession(origin, authPlatform), reason: null }; }
    catch { return { controller: null, reason: 'The backend address must be a valid HTTPS origin.' }; }
  });
  const controller = setup.controller;
  const [state, setState] = useState<AccountState>(controller?.state ?? { status: 'signedOut', profile: null, hasSession: false, expiresAt: null, message: null });
  useEffect(() => {
    if (!controller) { return; }
    let active = true;
    const unsubscribe = controller.subscribe(value => { if (active) { setState(value); } });
    const ready = Linking.getInitialURL().catch(() => null).then(url => controller.initialize(url));
    const linking = Linking.addEventListener('url', event => {
      if (event.url.startsWith('com.fitnessai.training:')) { void ready.then(() => { if (active) { return controller.complete(event.url); } }); }
    });
    const appState = AppState.addEventListener('change', value => {
      if (value === 'active' && controller.state.hasSession && controller.state.status === 'signedIn') { void controller.refresh(); }
    });
    return () => { active = false; unsubscribe(); linking.remove(); appState.remove(); };
  }, [controller]);
  useEffect(() => {
    if (!controller || !state.expiresAt) { return; }
    const timeout = setTimeout(() => { void controller.refresh(); }, Math.max(0, state.expiresAt * 1000 - Date.now()));
    return () => clearTimeout(timeout);
  }, [controller, state.expiresAt]);
  return { state, reason: setup.reason, appleAvailable: nativeAppleAuthAvailable(), diagnostics: () => controller ? { ...controller.diagnostics, displayedStatus: state.status } : null,
    signInWithApple: () => controller?.signInWithApple(), signIn: () => controller?.signIn(), cancel: () => controller?.cancel(), retry: () => controller?.refresh(), signOut: () => controller?.signOut() };
}
