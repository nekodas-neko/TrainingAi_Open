import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { z } from 'zod';
import { useAccountContext } from '../account/AccountProvider';
import { usePlatformIntegrations } from '../platform/PlatformProvider';
import { appHandoff } from '../../integrations/app-handoff/platform';
import { useHealthData } from './data/HealthDataProvider';
import { overlaySleep, type HealthStore } from './data/HealthStore';
import {
  HAND_BACK_MS,
  IDLE,
  OURA_PACKAGE,
  createHandoffRunner,
  currentHandoffState,
  hasLastNight,
  waitForNight,
  type HandoffState,
  type HandoffStatus,
} from './data/oura-handoff';

export type OuraHandoffStatus = HandoffStatus;
const Context = createContext<{ status: OuraHandoffStatus; syncNow: () => void }>({
  status: 'idle',
  syncNow: () => {},
});
const connectionSchema = z.object({ connected: z.boolean() });
// A manual retry gives Oura longer in front than the automatic morning hand-off.
const MANUAL_HAND_BACK_MS = 5_000;

// Quiet, so the Health screen's spinner does not flicker on every check while waiting.
async function nightIn(store: HealthStore, day: string) {
  await store.refresh(true, { quiet: true });
  const state = store.getSnapshot();
  return hasLastNight(overlaySleep(state.sleep ?? [], state.operations), day);
}

// On a morning open with Oura connected and last night missing, opens the Oura app for a moment
// so it syncs, then waits for the night to arrive (#2896). Runs at most once per local morning;
// the sequence itself is `createHandoffRunner`.
export function OuraHandoffProvider({ children }: PropsWithChildren) {
  const { dataReader } = useAccountContext();
  const { store: health, timezone, today } = useHealthData();
  const { store: platform, state: platformState } = usePlatformIntegrations();
  const [state, setState] = useState<HandoffState>(IDLE);
  const mounted = useRef(true);
  const timezoneRef = useRef(timezone);
  useEffect(() => {
    timezoneRef.current = timezone;
  }, [timezone]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const runner = useMemo(() => {
    if (!health || !platform || !dataReader || !appHandoff) return null;
    const handoff = appHandoff;
    return createHandoffRunner({
      settings: async () => {
        await platform.initialize();
        const { ready, settings } = platform.getSnapshot();
        return ready
          ? { enabled: settings.ouraMorningSync, lastRunDay: settings.ouraHandoffDay }
          : null;
      },
      supported: true,
      installed: () => handoff.isInstalled(OURA_PACKAGE),
      now: Date.now,
      timezone: () => timezoneRef.current,
      connected: async () =>
        connectionSchema.safeParse(await dataReader.get('/api/oura/connection').catch(() => null))
          .data?.connected === true,
      lastNight: (day) => nightIn(health, day),
      active: () => mounted.current && AppState.currentState === 'active',
      saveDay: (ouraHandoffDay) => platform.configure({ ouraHandoffDay }),
      open: (manual) =>
        handoff.openAppBriefly(OURA_PACKAGE, manual ? MANUAL_HAND_BACK_MS : HAND_BACK_MS),
      stayedBehind: (day) =>
        platform.configure({ ouraMorningSync: false, ouraHandoffStrandedDay: day }),
      wait: (day) =>
        waitForNight({
          landed: () => nightIn(health, day),
          cancelled: () => !mounted.current,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: Date.now,
        }),
      setState: (next) => {
        if (mounted.current) setState(next);
      },
    });
  }, [health, platform, dataReader]);
  const handOff = useCallback(
    (manual: boolean) => {
      void runner?.run(manual).catch(() => {
        if (mounted.current) setState(IDLE);
      });
    },
    [runner],
  );
  useEffect(() => {
    handOff(false);
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active') handOff(false);
    });
    return () => listener.remove();
  }, [handOff]);
  const enabled = platformState?.settings.ouraMorningSync ?? false;
  const shown = currentHandoffState(state, today, enabled);
  const value = useMemo(
    () => ({ status: shown.status, syncNow: () => handOff(true) }),
    [shown.status, handOff],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useOuraHandoff() {
  return useContext(Context);
}
