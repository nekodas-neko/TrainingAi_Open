import {
  VOICE_LOG_EXAMPLE,
  clampVoiceLogResult,
  parseVoice,
} from '@trainingai/shared/workout/voice-log';
import { storedLoad } from '../logging/preferences.ts';

export type SpeechEngine = {
  available(): boolean;
  requestPermission(): Promise<boolean>;
  /** The transcript, or null when nothing was heard. Rejects with a SpeechError. */
  listen(): Promise<string | null>;
  stop(): void;
};

export class SpeechError extends Error {
  constructor(readonly code: string) {
    super(`Speech recognition failed (${code})`);
  }
}

export type VoiceOutcome =
  | { kind: 'set'; weight?: number; reps?: number }
  | { kind: 'message'; message: string };

const message = (text: string): VoiceOutcome => ({ kind: 'message', message: text });

/**
 * One tap: ask for the microphone, listen, parse. It only reports what was heard. The caller puts
 * it on the wheels and the user logs the set as usual, so a misheard phrase never saves anything.
 */
export async function captureSet(engine: SpeechEngine): Promise<VoiceOutcome> {
  try {
    if (!engine.available()) return message('Speech recognition unavailable on this device');
    if (!(await engine.requestPermission())) return message('Microphone permission denied');
    const transcript = await engine.listen();
    if (!transcript) return message('Did not catch that');
    const { weight, reps } = parseVoice(transcript);
    if (weight === undefined && reps === undefined) {
      return message(`Didn't understand "${transcript}" — try "${VOICE_LOG_EXAMPLE}"`);
    }
    return { kind: 'set', ...clampVoiceLogResult(weight, reps) };
  } catch (error) {
    if (error instanceof SpeechError) {
      if (error.code === 'not-allowed') return message('Microphone permission denied');
      if (error.code === 'service-not-allowed' || error.code === 'language-not-supported') {
        return message('Speech recognition unavailable on this device');
      }
    }
    return message('Voice logging failed');
  }
}

/**
 * What the wheels take from a heard set: the weight read in the unit on the wheel, rounded to its
 * step and stored as kg, and the reps as the counter stores them.
 */
export function voiceSetValues(
  heard: { weight?: number; reps?: number },
  step: number,
  unit: 'kg' | 'lb',
): { weight?: string; reps?: string } {
  return {
    ...(heard.weight !== undefined && {
      weight: storedLoad(String(Number((Math.round(heard.weight / step) * step).toFixed(2))), unit),
    }),
    ...(heard.reps !== undefined && { reps: String(heard.reps) }),
  };
}
