import { Share } from 'react-native';
import { AppText, Icon, IconButton, Stack, StatusIndicator } from '../../../shared/ui';
import { useWorkoutAction } from '../../workouts/data/useWorkoutAction';
export function FriendCode({ code }: { code: string | null | undefined }) {
  const action = useWorkoutAction();
  return (
    <Stack direction="row" align="center" justify="center" gap="xs">
      <Icon name="users" tone="muted" />
      <AppText
        selectable
        variant="caption"
        tone="muted"
        accessibilityLabel={`Your friend code: ${code ?? 'unavailable'}`}
        accessibilityHint="Touch and hold to copy your friend code"
      >
        {code ?? '—'}
      </AppText>
      <IconButton
        icon="share"
        label="Share friend code"
        disabled={!code}
        onPress={() =>
          void action.run(() =>
            Share.share({ message: `Add me on TrainingAi with friend code ${code}` }),
          )
        }
      />
      <StatusIndicator label="Share friend code" error={action.error} />
    </Stack>
  );
}
