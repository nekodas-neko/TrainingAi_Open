import { useEffect, useState } from 'react';
import { AccessibilityInfo, Share } from 'react-native';
import { AppText, IconButton, Stack, StatusIndicator } from '../../../shared/ui';
import { useWorkoutAction } from '../../workouts/data/useWorkoutAction';
export function FriendCode({ code }: { code: string | null | undefined }) {
  const share = useWorkoutAction(),
    copy = useWorkoutAction();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const error = share.error ?? copy.error;
  return (
    <Stack direction="row" align="center" justify="center" gap="xs">
      <AppText
        selectable
        mono
        variant="caption"
        tone="muted"
        accessibilityLabel={`Your friend code: ${code ?? 'unavailable'}`}
        accessibilityHint="Touch and hold to copy your friend code"
      >
        {code ?? '—'}
      </AppText>
      {error ? (
        <StatusIndicator
          label="Friend code"
          error={error}
          onRetry={() => {
            share.clear();
            copy.clear();
          }}
          actionLabel="Dismiss"
        />
      ) : (
        <>
          <IconButton
            icon={copied ? 'check' : 'copy'}
            label="Copy friend code"
            disabled={!code}
            onPress={() =>
              void copy.run(async () => {
                if (!code) return;
                // Loaded on tap: a static import would require the native module at app launch.
                const Clipboard = await import('expo-clipboard');
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
            busy={share.busy}
            onPress={() =>
              void share.run(() =>
                Share.share({ message: `Add me on TrainingAi with friend code ${code}` }),
              )
            }
          />
        </>
      )}
    </Stack>
  );
}
