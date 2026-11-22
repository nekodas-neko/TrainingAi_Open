import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';

// Only the start-up storage screen uses this: it has no Back and no tab bar. Every other page
// draws its header through PageLayout (#3760).
export function Screen({ title, children }: PropsWithChildren<{ title: string }>) {
  const { theme } = useTheme();
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
        <Stack gap="xs">
          <AppText variant="eyebrow" tone="brand">
            TrainingAi
          </AppText>
          <AppText variant="pageTitle">{title}</AppText>
        </Stack>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
