import { useAndroidBack } from './useAndroidBack';
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
import { ReorderScrollView } from './ReorderScrollView';
import { NestedScrollGesture, useNestedScrollBoundary } from './NestedScrollGesture';

export function PageLayout({
  title,
  subtitle,
  actions,
  children,
  header,
  hideHeader = false,
  scroll = false,
  footer,
  floatingAction,
  contentStyle,
  onBack,
  landing = false,
  reorderable = false,
  fillBottom = false,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  header?: ReactNode;
  hideHeader?: boolean;
  scroll?: boolean;
  footer?: ReactNode;
  floatingAction?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  onBack?: () => void;
  landing?: boolean;
  reorderable?: boolean;
  fillBottom?: boolean;
}>) {
  const { theme } = useTheme();
  const nestedScroll = useNestedScrollBoundary();
  useAndroidBack(onBack);
  const ContentScrollView = reorderable ? ReorderScrollView : ScrollView;
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
            borderBottomWidth: landing ? 0 : 1,
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
            paddingVertical: theme.spacing[landing ? 'lg' : 'md'],
            borderBottomWidth: landing ? 0 : 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          {onBack && <IconButton icon="back" label="Back" onPress={onBack} />}
          <View style={{ flex: 1 }}>
            <AppText variant={landing ? 'title' : 'pageTitle'} accessibilityRole="header">
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
          paddingTop: theme.spacing.md,
          paddingBottom: landing || fillBottom ? 0 : theme.spacing.md,
          gap: theme.spacing.md,
        }}
      >
        {scroll ? (
          <NestedScrollGesture.Provider value={nestedScroll.control}>
            <ContentScrollView
              scrollEnabled={!nestedScroll.locked}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={[
                {
                  flexGrow: 1,
                  paddingHorizontal: theme.spacing.lg,
                  paddingBottom: fillBottom ? 0 : theme.spacing.md,
                  gap: theme.spacing.md,
                },
                contentStyle,
              ]}
            >
              {children}
            </ContentScrollView>
          </NestedScrollGesture.Provider>
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
      {floatingAction && (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            right: theme.spacing.lg,
            bottom: theme.spacing.md,
          }}
        >
          {floatingAction}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
