import { useCallback, useEffect, useRef, useState } from 'react';
import { VOICE_LOG_EXAMPLE } from '@trainingai/shared/workout/voice-log';
import { AppButton, AppText, Stack } from '../../../shared/ui';
import { captureSet, type SpeechEngine } from '../voice/voice';

/**
 * Speaks a set into the wheels. It never logs: the user still taps Log Set. The caller passes an
 * engine only where speech can run (`useVoiceEngine`), so there is nothing to draw otherwise.
 */
export function VoiceLogButton({
  engine,
  onResult,
  disabled = false,
}: {
  engine: SpeechEngine;
  /** False when the values could not be put on the wheels. */
  onResult: (result: { weight?: number; reps?: number }) => Promise<boolean>;
  disabled?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      engine.stop();
    };
  }, [engine]);
  const press = useCallback(async () => {
    if (listening) {
      engine.stop();
      return;
    }
    setError(null);
    setListening(true);
    const outcome = await captureSet(engine);
    if (!mounted.current) return;
    setListening(false);
    if (outcome.kind === 'message') {
      setError(outcome.message);
      return;
    }
    const applied = await onResult(outcome);
    if (mounted.current && !applied) setError('Could not apply that — try again');
  }, [engine, listening, onResult]);
  return (
    <Stack align="center" gap="xs">
      <AppButton
        title={listening ? 'Listening…' : 'Voice'}
        icon={listening ? 'micOff' : 'mic'}
        variant="secondary"
        accessibilityLabel={listening ? 'Stop listening' : 'Log by voice'}
        disabled={disabled}
        onPress={() => void press()}
      />
      <AppText
        variant="caption"
        tone={error ? 'danger' : 'muted'}
        numberOfLines={1}
        style={{ textAlign: 'center' }}
      >
        {error ?? (listening ? 'Say the weight and reps' : `Say "${VOICE_LOG_EXAMPLE}"`)}
      </AppText>
    </Stack>
  );
}
