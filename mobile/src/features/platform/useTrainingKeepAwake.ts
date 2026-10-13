import { useEffect, useId } from 'react';
import { keepAwake } from '../../integrations/keep-awake/platform';
import { usePlatformIntegrations } from './PlatformProvider';
export function useTrainingKeepAwake(active: boolean) {
  const { state } = usePlatformIntegrations();
  const tag = useId();
  const enabled = active && state?.settings.keepAwake !== false;
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    void keepAwake(tag, true)
      .then(() => {
        if (!mounted) void keepAwake(tag, false).catch(() => {});
      })
      .catch(() => {});
    return () => {
      mounted = false;
      void keepAwake(tag, false).catch(() => {});
    };
  }, [tag, enabled]);
}
