import type { PreviewControls } from './controls';
export type { PreviewControls } from './controls';

/**
 * The web build. Only a development export made for the browser preview (#3761) exposes the
 * controls; `__DEV__` is false in a production export, so Metro folds this branch away and
 * `preview-controls.ts` is not bundled.
 */
export const usePreviewControls: (controls: PreviewControls) => void =
  __DEV__ && process.env.EXPO_PUBLIC_WEB_PREVIEW_AUTH === '1'
    ? (require('./preview-controls') as typeof import('./preview-controls')).usePreviewControls
    : () => {};
