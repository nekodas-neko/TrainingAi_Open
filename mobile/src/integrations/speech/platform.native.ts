import { requireOptionalNativeModule } from 'expo';
import type { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { SpeechError, type SpeechEngine } from '../../features/workouts/voice/voice.ts';

type Native = typeof ExpoSpeechRecognitionModule;

// Absent on builds made before the module existed; importing the package would throw there.
export function createSpeechEngine(): SpeechEngine | null {
  const native = requireOptionalNativeModule<Native>('ExpoSpeechRecognition');
  if (!native) return null;
  return {
    available: () => native.isRecognitionAvailable(),
    async requestPermission() {
      const { granted } = await native.requestPermissionsAsync();
      return granted;
    },
    listen: () =>
      new Promise((resolve, reject) => {
        let transcript: string | null = null;
        const subscriptions = [
          native.addListener('result', (event) => {
            transcript = event.results[0]?.transcript ?? transcript;
          }),
          native.addListener('error', (event) => {
            finish();
            if (['no-speech', 'speech-timeout', 'aborted'].includes(event.error)) resolve(null);
            else reject(new SpeechError(event.error));
          }),
          native.addListener('end', () => {
            finish();
            resolve(transcript);
          }),
        ];
        function finish() {
          for (const subscription of subscriptions) subscription.remove();
        }
        native.start({ lang: 'en-US', interimResults: false, maxAlternatives: 1 });
      }),
    stop: () => native.stop(),
  };
}
