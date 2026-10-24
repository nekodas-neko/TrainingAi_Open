import { useMemo } from 'react';
import { createSpeechEngine } from '../../../integrations/speech/platform';
import type { SpeechEngine } from './voice';

/** The engine only where speech can run, else null so the control is not drawn. */
export function useVoiceEngine(enabled = true): SpeechEngine | null {
  return useMemo(() => engineIfEnabled(enabled, createSpeechEngine), [enabled]);
}

/** A set already recorded passes `enabled: false`, and then speech is never even looked for. */
export function engineIfEnabled(
  enabled: boolean,
  create: () => SpeechEngine | null,
): SpeechEngine | null {
  return enabled ? usableEngine(create()) : null;
}

export function usableEngine(engine: SpeechEngine | null): SpeechEngine | null {
  try {
    return engine?.available() ? engine : null;
  } catch {
    return null;
  }
}
