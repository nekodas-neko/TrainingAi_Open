import { useState, type PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Skeleton } from './Skeleton';
import { useTheme } from '../theme/ThemeProvider';

export function StableContent({
  loading = false,
  minHeight = 0,
  frameHeight,
  children,
}: PropsWithChildren<{
  loading?: boolean;
  minHeight?: number;
  frameHeight?: number;
}>) {
  const { theme } = useTheme();
  const [height, setHeight] = useState(minHeight);
  const content = (
    <View
      accessibilityElementsHidden={loading}
      importantForAccessibility={loading ? 'no-hide-descendants' : 'auto'}
      aria-hidden={loading}
      pointerEvents={loading ? 'none' : 'auto'}
      style={{ opacity: loading ? 0 : 1, gap: theme.spacing.md }}
      onLayout={(event) => {
        if (!loading) {
          const next = event.nativeEvent.layout.height;
          setHeight((old) => Math.max(old, next));
        }
      }}
    >
      {children}
    </View>
  );
  return (
    <View
      style={{
        minHeight: frameHeight === undefined ? Math.max(height, minHeight) : undefined,
        height: frameHeight,
        overflow: loading || frameHeight !== undefined ? 'hidden' : 'visible',
      }}
    >
      {frameHeight === undefined ? (
        content
      ) : (
        <ScrollView
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          pointerEvents={loading ? 'none' : 'auto'}
          style={{ flex: 1 }}
        >
          {content}
        </ScrollView>
      )}
      {loading && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.colors.surface, gap: theme.spacing.md },
          ]}
          pointerEvents="none"
        >
          <Skeleton style={{ width: '65%', height: theme.typography.caption.lineHeight }} />
          <Skeleton style={{ flex: 1 }} />
        </View>
      )}
    </View>
  );
}
