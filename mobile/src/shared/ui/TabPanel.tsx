import { ReorderScrollView } from './ReorderScrollView';
import { useRef, type PropsWithChildren } from 'react';
import { RefreshControl, type ScrollView } from 'react-native';
import { useScrollToTop } from './ScrollToTop';
import { useTheme } from '../theme/ThemeProvider';

export function TabPanel({
  children,
  refreshing = false,
  onRefresh,
}: PropsWithChildren<{
  refreshing?: boolean;
  onRefresh?: () => void;
}>) {
  const { theme } = useTheme();
  const view = useRef<ScrollView>(null);
  useScrollToTop(view);
  return (
    <ReorderScrollView
      scrollRef={view}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.brandText}
          />
        ) : undefined
      }
      contentContainerStyle={{
        paddingVertical: theme.spacing.md,
        paddingBottom: theme.spacing.xl,
        gap: theme.spacing.lg,
      }}
    >
      {children}
    </ReorderScrollView>
  );
}
