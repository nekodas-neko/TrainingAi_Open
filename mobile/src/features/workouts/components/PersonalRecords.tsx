import { Share, View } from 'react-native';
import { Pressable } from '../../../shared/ui/Pressable';
import { AppText, Icon, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { personalRecordShareText } from '../logging/summary';

/**
 * #3671. The done screen's "Personal Records" card, as the current app draws it above its XP and
 * stats: a trophy heading in amber that shares the workout, then each exercise that set one, which
 * shares that record. Nothing is drawn when the session set none.
 */
export function PersonalRecords({
  names,
  shareWorkout,
}: {
  names: readonly string[];
  shareWorkout: () => void;
}) {
  const { theme } = useTheme();
  if (!names.length) return null;
  const palette = theme.tones.checkin;
  return (
    <View
      style={{
        width: '100%',
        maxWidth: theme.sizes.summaryWidth,
        borderRadius: theme.radii.card,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.background,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        gap: theme.spacing.xs,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share personal records"
        onPress={shareWorkout}
        style={{ minHeight: theme.sizes.touchTarget, justifyContent: 'center' }}
      >
        <Stack direction="row" align="center" justify="space-between">
          <Stack direction="row" align="center" gap="xs">
            <Icon name="trophy" size={theme.sizes.iconSmall * 0.7} color={palette.foreground} />
            <AppText variant="caption" style={{ color: palette.foreground, fontWeight: '700' }}>
              Personal Records
            </AppText>
          </Stack>
          <Icon name="share" size={theme.sizes.iconSmall * 0.7} color={palette.foreground} />
        </Stack>
      </Pressable>
      {names.map((name) => (
        <Pressable
          key={name}
          accessibilityRole="button"
          accessibilityLabel={`Share personal record on ${name}`}
          onPress={() => void Share.share({ message: personalRecordShareText(name) })}
          style={{ minHeight: theme.sizes.touchTarget, justifyContent: 'center' }}
        >
          <Stack direction="row" align="center" justify="space-between">
            <AppText variant="label" style={{ color: palette.foreground, flex: 1 }}>
              {name}
            </AppText>
            <Icon name="share" size={theme.sizes.iconSmall * 0.6} color={palette.foreground} />
          </Stack>
        </Pressable>
      ))}
    </View>
  );
}
