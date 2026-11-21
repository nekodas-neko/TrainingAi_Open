import { useEffect, useRef } from 'react';
import type { PreviewControls } from './controls';

/** The global `scripts/web-screens.mjs` drives. Also what the release-bundle guard looks for. */
export const PREVIEW_CONTROLS_GLOBAL = '__trainingaiPreview';

/**
 * #3761. Development web export only (see `controls.web.ts`): puts the app's own navigation on
 * `window` so the screen script can open any screen the way a tap would, without guessing labels.
 */
export function usePreviewControls(controls: PreviewControls) {
  const latest = useRef(controls);
  latest.current = controls;
  useEffect(() => {
    const target = window as unknown as Record<string, unknown>;
    target[PREVIEW_CONTROLS_GLOBAL] = {
      selectTab: (...args: Parameters<PreviewControls['selectTab']>) =>
        latest.current.selectTab(...args),
      open: (...args: Parameters<PreviewControls['open']>) => latest.current.open(...args),
      healthPanel: (...args: Parameters<PreviewControls['healthPanel']>) =>
        latest.current.healthPanel(...args),
      nutritionDate: (...args: Parameters<PreviewControls['nutritionDate']>) =>
        latest.current.nutritionDate(...args),
      where: () => latest.current.where(),
    };
    return () => {
      delete target[PREVIEW_CONTROLS_GLOBAL];
    };
  }, []);
}
