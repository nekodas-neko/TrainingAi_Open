import { View } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';

export function CompletionStamp({ label = 'COMPLETED' }: { label?: string }) {
  const { theme } = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          transform: [{ rotate: '-12deg' }],
          borderWidth: 3,
          borderColor: theme.anatomy.main,
          borderRadius: theme.radii.small,
          padding: theme.spacing.xxs,
          backgroundColor: theme.colors.surface,
        }}
      >
        <View
          style={{
            borderWidth: 1,
            borderColor: theme.anatomy.main,
            borderRadius: theme.radii.small,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.sm,
            backgroundColor: `${theme.anatomy.main}2e`,
          }}
        >
          <AppText
            variant="pageTitle"
            style={{ color: theme.anatomy.main, letterSpacing: 3, fontWeight: '900' }}
          >
            {label}
          </AppText>
        </View>
      </View>
    </View>
  );
}
