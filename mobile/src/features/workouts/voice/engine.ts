import { SpeechError, type SpeechEngine } from './voice.ts';

type Subscription = { remove(): void };
/** The slice of the native module the engine uses. */
export type SpeechModule = {
  isRecognitionAvailable(): boolean;
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  addListener(event: 'result', listener: (e: { results: { transcript: string }[] }) => void): Subscription;
  addListener(event: 'error', listener: (e: { error: string }) => void): Subscription;
  addListener(event: 'end', listener: () => void): Subscription;
  start(options: { lang: string; interimResults: boolean; maxAlternatives: number }): void;
  stop(): void;
};

const SILENT_ENDS = ['no-speech', 'speech-timeout', 'aborted'];

export function speechEngineFor(native: SpeechModule | null | undefined): SpeechEngine | null {
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
        const subscriptions: Subscription[] = [];
        const finish = () => {
          for (const subscription of subscriptions) subscription.remove();
        };
        try {
          subscriptions.push(
            native.addListener('result', (event) => {
              transcript = event.results[0]?.transcript ?? transcript;
            }),
            native.addListener('error', (event) => {
              finish();
              if (SILENT_ENDS.includes(event.error)) resolve(null);
              else reject(new SpeechError(event.error));
            }),
            native.addListener('end', () => {
              finish();
              resolve(transcript);
            }),
          );
          native.start({ lang: 'en-US', interimResults: false, maxAlternatives: 1 });
        } catch (error) {
          finish();
          reject(error);
        }
      }),
    stop: () => native.stop(),
  };
}
