import type { PropsWithChildren } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
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
  return (
    <ScrollView
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
    </ScrollView>
  );
}
