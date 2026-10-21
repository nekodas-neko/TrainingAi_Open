import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VOICE_LOG_EXAMPLE } from '@trainingai/shared/workout/voice-log';
import { createSpeechEngine } from '../../../integrations/speech/platform';
import { AppButton, AppText, Stack } from '../../../shared/ui';
import { captureSet } from '../voice/voice';

/**
 * Speaks a set into the wheels. It never logs: the user still taps Log Set. Hidden where speech
 * recognition is missing (web, or an app build made before the module existed).
 */
export function VoiceLogButton({
  onResult,
  disabled = false,
}: {
  onResult: (result: { weight?: number; reps?: number }) => void;
  disabled?: boolean;
}) {
  const engine = useMemo(() => {
    const created = createSpeechEngine();
    return created?.available() ? created : null;
  }, []);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      engine?.stop();
    },
    [engine],
  );
  const press = useCallback(async () => {
    if (!engine) return;
    if (listening) {
      engine.stop();
      return;
    }
    setError(null);
    setListening(true);
    const outcome = await captureSet(engine);
    if (!mounted.current) return;
    setListening(false);
    if (outcome.kind === 'set') onResult(outcome);
    else setError(outcome.message);
  }, [engine, listening, onResult]);
  if (!engine) return null;
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
      <AppText variant="caption" tone={error ? 'danger' : 'muted'} style={{ textAlign: 'center' }}>
        {error ?? (listening ? 'Say the weight and reps' : `Say "${VOICE_LOG_EXAMPLE}"`)}
      </AppText>
    </Stack>
  );
}
