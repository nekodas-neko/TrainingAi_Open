import { View, type ViewProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function Skeleton({ style, ...props }: ViewProps) {
  const { theme } = useTheme();
  return (
    <View
      {...props}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        { backgroundColor: theme.colors.raised, borderRadius: theme.radii.control },
        style,
      ]}
    />
  );
}
