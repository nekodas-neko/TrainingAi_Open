import { requireOptionalNativeModule } from 'expo';
import type { AudioPlayer } from 'expo-audio';

// The current app's rest beep (`components/workout/beep.ts`): an 880 Hz sine fading from 0.4 to
// silence over 400 ms, rendered to a WAV because there is no Web Audio here.
let player: Promise<AudioPlayer> | null = null;

// Plays on the media stream without taking audio focus, as the WebView's Web Audio beep does:
// music keeps playing, and media volume rather than the ringer switch decides whether it is heard.
async function load() {
  const audio = await import('expo-audio');
  await audio.setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
  return audio.createAudioPlayer(require('../../../assets/sounds/rest-beep.wav'));
}

/** Never throws: a missing beep must never break the timer that asked for it. */
export function playBeep() {
  try {
    if (!requireOptionalNativeModule('ExpoAudio')) return;
    player ??= load();
    void player
      .then((p) => {
        void p.seekTo(0).catch(() => {});
        p.play();
      })
      .catch(() => {
        player = null;
      });
  } catch {}
}
