import { View, type ViewProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { Space } from '../theme/tokens';

export function Stack({
  gap = 'sm',
  direction = 'column',
  align,
  justify,
  wrap = false,
  style,
  ...props
}: ViewProps & {
  gap?: Space;
  direction?: 'row' | 'column';
  align?: 'center' | 'flex-start' | 'flex-end' | 'stretch' | 'baseline';
  justify?: 'center' | 'space-between';
  wrap?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View
      {...props}
      style={[
        {
          flexDirection: direction,
          gap: theme.spacing[gap],
          alignItems: align,
          justifyContent: justify,
          flexWrap: wrap ? 'wrap' : 'nowrap',
        },
        style,
      ]}
    />
  );
}
