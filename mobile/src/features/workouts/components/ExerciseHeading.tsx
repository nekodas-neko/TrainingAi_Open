import { View } from 'react-native';
import { AppText, Icon, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { ExerciseMedia } from './ExerciseMedia';

export function ExerciseThumbnail({ compact = false, name }: { compact?: boolean; name?: string }) {
  if (name) {
    return <ExerciseMedia name={name} compact={compact} />;
  }
  return <EmptyThumbnail compact={compact} />;
}
function EmptyThumbnail({ compact }: { compact: boolean }) {
  const { theme } = useTheme();
  const size = compact ? theme.sizes.touchTarget : theme.sizes.demonstration;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radii.control,
        backgroundColor: theme.colors.raised,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Icon name="workout" tone="muted" />
    </View>
  );
}
export function ExerciseHeading({ name }: { name: string }) {
  return (
    <Stack direction="row" align="center" gap="md">
      <ExerciseThumbnail name={name} />
      <AppText variant="title" style={{ flex: 1 }}>
        {name}
      </AppText>
    </Stack>
  );
}
