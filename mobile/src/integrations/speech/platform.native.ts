import { requireOptionalNativeModule } from 'expo';
import { speechEngineFor, type SpeechModule } from '../../features/workouts/voice/engine.ts';
import type { SpeechEngine } from '../../features/workouts/voice/voice.ts';

// Absent on builds made before the module existed; importing the package would throw there.
export function createSpeechEngine(): SpeechEngine | null {
  return speechEngineFor(requireOptionalNativeModule<SpeechModule>('ExpoSpeechRecognition'));
}
