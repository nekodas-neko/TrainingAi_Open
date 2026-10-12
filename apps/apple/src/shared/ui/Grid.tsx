import { Children, type PropsWithChildren } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { Space } from '../theme/tokens';

export function Grid({
  columns = 2,
  gap = 'md',
  children,
}: PropsWithChildren<{ columns?: 2 | 3 | 4; gap?: Space }>) {
  const { theme } = useTheme();
  const gutter = theme.spacing[gap] / 2;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -gutter }}>
      {Children.map(children, (child) =>
        child == null ? null : (
          <View style={{ width: `${100 / columns}%`, padding: gutter }}>{child}</View>
        ),
      )}
    </View>
  );
}
