import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';

export function Avatar({ name }: { name: string }) {
  const { theme } = useTheme();
  return (
    <View
      accessible={false}
      style={{
        width: theme.sizes.avatar,
        height: theme.sizes.avatar,
        borderRadius: theme.radii.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.brandSurface,
        borderWidth: 1,
        borderColor: theme.colors.brandBorder,
      }}
    >
      <AppText variant="hero" tone="brand">
        {name.charAt(0).toUpperCase()}
      </AppText>
    </View>
  );
}
