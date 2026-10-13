import { ActivityIndicator, type ActivityIndicatorProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function LoadingIndicator(props: ActivityIndicatorProps) {
  const { theme } = useTheme();
  return <ActivityIndicator color={theme.colors.brand} {...props} />;
}
