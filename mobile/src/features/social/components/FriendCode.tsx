import { useEffect, useState } from 'react';
import { AccessibilityInfo, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { AppText, IconButton, Stack, StatusIndicator } from '../../../shared/ui';
import { useWorkoutAction } from '../../workouts/data/useWorkoutAction';
export function FriendCode({ code }: { code: string | null | undefined }) {
  const action = useWorkoutAction();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Stack direction="row" align="center" justify="center" gap="xs">
      <AppText
        selectable
        variant="caption"
        tone="muted"
        accessibilityLabel={`Your friend code: ${code ?? 'unavailable'}`}
        accessibilityHint="Touch and hold to copy your friend code"
      >
        {code ?? '—'}
      </AppText>
      {action.error ? (
        <StatusIndicator
          label="Friend code"
          error={action.error}
          onRetry={action.clear}
          actionLabel="Dismiss"
        />
      ) : (
        <>
          <IconButton
            icon={copied ? 'check' : 'copy'}
            label={copied ? 'Friend code copied' : 'Copy friend code'}
            disabled={!code}
            onPress={() =>
              void action.run(async () => {
                if (!code) return;
                await Clipboard.setStringAsync(code);
                setCopied(true);
                AccessibilityInfo.announceForAccessibility('Friend code copied');
              })
            }
          />
          <IconButton
            icon="share"
            label="Share friend code"
            disabled={!code}
            busy={action.busy}
            onPress={() =>
              void action.run(() =>
                Share.share({ message: `Add me on TrainingAi with friend code ${code}` }),
              )
            }
          />
        </>
      )}
    </Stack>
  );
}
