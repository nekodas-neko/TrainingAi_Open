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
  OURA_PACKAGE,
  hasLastNight,
  morningHandoffDecision,
  waitForNight,
} from './data/oura-handoff';

export type OuraHandoffStatus = 'idle' | 'syncing' | 'timeout';
const Context = createContext<{ status: OuraHandoffStatus; syncNow: () => void }>({
  status: 'idle',
  syncNow: () => {},
});
const connectionSchema = z.object({ connected: z.boolean() });
// A manual retry gives Oura longer in front than the automatic morning hand-off.
const MANUAL_HAND_BACK_MS = 5_000;

async function nightIn(store: HealthStore, day: string) {
  await store.refresh(true);
  const state = store.getSnapshot();
  return hasLastNight(overlaySleep(state.sleep ?? [], state.operations), day);
}

// On a morning open with Oura connected and last night missing, opens the Oura app for a moment
// so it syncs, then waits for the night to arrive (#2896). Runs at most once per local morning.
export function OuraHandoffProvider({ children }: PropsWithChildren) {
  const { dataReader } = useAccountContext();
  const { store: health, timezone } = useHealthData();
  const { store: platform } = usePlatformIntegrations();
  const [status, setStatus] = useState<OuraHandoffStatus>('idle');
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const handOff = useCallback(
    async (manual: boolean) => {
      if (running.current || !health || !platform || !dataReader || !appHandoff) return;
      running.current = true;
      try {
        await platform.initialize();
        const { ready, settings } = platform.getSnapshot();
        if (!ready) return;
        const now = Date.now();
        const decision = await morningHandoffDecision({
          manual,
          enabled: settings.ouraMorningSync,
          supported: true,
          installed: () => appHandoff!.isInstalled(OURA_PACKAGE),
          lastRunDay: settings.ouraHandoffDay,
          now,
          timezone,
          lastNight: (day) => nightIn(health, day),
          connected: async () =>
            connectionSchema.safeParse(
              await dataReader.get('/api/oura/connection').catch(() => null),
            ).data?.connected === true,
        });
        if (!decision.run || (!manual && !mounted.current)) return;
        // Recorded before Oura opens, so coming back to the front cannot start it again.
        await platform.configure({ ouraHandoffDay: decision.day });
        setStatus('syncing');
        await appHandoff
          .openAppBriefly(OURA_PACKAGE, manual ? MANUAL_HAND_BACK_MS : HAND_BACK_MS)
          .catch(() => null);
        const outcome = await waitForNight({
          landed: () => nightIn(health, decision.day),
          cancelled: () => !mounted.current,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: Date.now,
        });
        if (outcome !== 'cancelled') setStatus(outcome === 'landed' ? 'idle' : 'timeout');
      } catch {
        if (mounted.current) setStatus('idle');
      } finally {
        running.current = false;
      }
    },
    [health, platform, dataReader, timezone],
  );
  useEffect(() => {
    void handOff(false);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void handOff(false);
    });
    return () => listener.remove();
  }, [handOff]);
  const value = useMemo(
    () => ({ status, syncNow: () => void handOff(true) }),
    [status, handOff],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useOuraHandoff() {
  return useContext(Context);
}
