import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { homeWidgets } from '../../integrations/widgets/platform';
import { parseLaunchTarget, type LaunchTarget } from './launch-target';

/**
 * Takes the screen a widget tap asked for, at launch and each time the app comes to the front.
 * A target is always consumed; while signed out (`enabled` false) it is dropped, so a tap made
 * during sign-in cannot navigate or touch the sign-in itself.
 */
export function useWidgetLaunch(enabled: boolean, onTarget: (target: LaunchTarget) => void) {
  const latest = useRef({ enabled, onTarget });
  latest.current = { enabled, onTarget };
  useEffect(() => {
    if (!homeWidgets) return;
    const take = () => {
      let raw: string | null = null;
      try {
        raw = homeWidgets?.takeLaunchTarget() ?? null;
      } catch {
        return;
      }
      const target = parseLaunchTarget(raw);
      if (target && latest.current.enabled) latest.current.onTarget(target);
    };
    take();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') take();
    });
    return () => subscription.remove();
  }, []);
}
