import type { PropsWithChildren, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { IconButton } from './IconButton';
import { useTheme } from '../theme/ThemeProvider';

export function PageLayout({
  title,
  subtitle,
  actions,
  children,
  header,
  hideHeader = false,
  scroll = false,
  footer,
  contentStyle,
  onBack,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  header?: ReactNode;
  hideHeader?: boolean;
  scroll?: boolean;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  onBack?: () => void;
}>) {
  const { theme } = useTheme();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        maxWidth: theme.sizes.contentWidth,
        alignSelf: 'center',
      }}
    >
      {hideHeader ? null : header ? (
        <View
          style={{
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          {header}
        </View>
      ) : (
        <Stack
          direction="row"
          align="center"
          justify="space-between"
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          {onBack && <IconButton icon="back" label="Back" onPress={onBack} />}
          <View style={{ flex: 1 }}>
            <AppText variant="pageTitle" accessibilityRole="header">
              {title}
            </AppText>
            {subtitle && (
              <AppText variant="caption" tone="muted">
                {subtitle}
              </AppText>
            )}
          </View>
          {actions && (
            <Stack direction="row" gap="xs">
              {actions}
            </Stack>
          )}
        </Stack>
      )}
      <View
        style={{
          flex: 1,
          minHeight: 0,
          paddingVertical: theme.spacing.md,
          gap: theme.spacing.md,
        }}
      >
        {scroll ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[
              {
                flexGrow: 1,
                paddingHorizontal: theme.spacing.lg,
                paddingBottom: theme.spacing.md,
                gap: theme.spacing.md,
              },
              contentStyle,
            ]}
          >
            {children}
          </ScrollView>
        ) : (
          children
        )}
      </View>
      {footer && (
        <Stack
          style={{
            padding: theme.spacing.lg,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          {footer}
        </Stack>
      )}
    </KeyboardAvoidingView>
  );
}
