import { useAndroidBack } from './useAndroidBack';
import type { PropsWithChildren, ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { AppText } from './AppText';
import { AppButton } from './AppButton';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';

export function Screen({
  title,
  backLabel,
  onBack,
  children,
  compact = false,
  footer,
}: PropsWithChildren<{
  title: string;
  backLabel?: string;
  onBack?: () => void;
  compact?: boolean;
  footer?: ReactNode;
}>) {
  const { theme } = useTheme();
  useAndroidBack(onBack);
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.xxl,
          gap: theme.spacing.xl,
          flexGrow: 1,
          maxWidth: theme.sizes.contentWidth,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <Stack
          gap="xs"
          direction={compact ? 'row' : 'column'}
          align={compact ? 'center' : undefined}
          justify={compact ? 'space-between' : undefined}
        >
          {onBack ? (
            <AppButton
              title={backLabel ?? 'Back'}
              icon="back"
              accessibilityLabel={`Back to ${backLabel ?? 'previous screen'}`}
              variant="ghost"
              onPress={onBack}
              style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }}
            />
          ) : (
            <AppText variant="eyebrow" tone="brand">
              TrainingAi
            </AppText>
          )}
          <AppText
            variant={compact ? 'heading' : 'pageTitle'}
            numberOfLines={compact ? 1 : undefined}
            style={compact ? { flexShrink: 1 } : undefined}
          >
            {title}
          </AppText>
        </Stack>
        {children}
      </ScrollView>
      {footer && (
        <Stack
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.sm,
            backgroundColor: theme.colors.background,
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
