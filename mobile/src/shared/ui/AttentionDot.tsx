import { View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The one red "something is waiting" mark: a bare dot, or a count when `count` is given. It sits
 * on the corner of whatever it flags and says nothing itself — the control it decorates carries the
 * TalkBack label, because a Pressable hides its children from the screen reader.
 */
export function AttentionDot({
  count,
  style,
}: {
  count?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const size = count === undefined ? theme.spacing.sm : theme.spacing.lg;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      style={[
        {
          position: 'absolute',
          top: -theme.spacing.xxs,
          right: -theme.spacing.xxs,
          minWidth: size,
          height: size,
          paddingHorizontal: count === undefined ? 0 : theme.spacing.xxs,
          borderRadius: theme.radii.pill,
          backgroundColor: theme.colors.danger,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {count !== undefined && (
        <AppText variant="micro" style={{ color: theme.colors.background }}>
          {count}
        </AppText>
      )}
    </View>
  );
}
