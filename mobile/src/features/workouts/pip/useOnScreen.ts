import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { inPictureInPicture } from '../../../integrations/feedback/beep';
import { pictureInPicture } from '../../../integrations/pip/platform';

/**
 * Whether the app's own screen is what the lifter sees: in the foreground and not shrunk into the
 * picture-in-picture window, where the screen still renders but the window's card is shown.
 */
export function useOnScreen(): boolean {
  const [app, setApp] = useState(AppState.currentState);
  const [pip, setPip] = useState(inPictureInPicture);
  useEffect(() => {
    const appState = AppState.addEventListener('change', setApp);
    const mode = pictureInPicture?.addListener('onModeChange', (event) => setPip(event.active));
    return () => {
      appState.remove();
      mode?.remove();
    };
  }, []);
  return app !== 'background' && !pip;
}
