import type { PropsWithChildren } from 'react';
import { ScrollView } from 'react-native';
import { AppText } from './AppText';
import { AppButton } from './AppButton';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';

export function Screen({
  title,
  backLabel,
  onBack,
  children,
}: PropsWithChildren<{ title: string; backLabel?: string; onBack?: () => void }>) {
  const { theme } = useTheme();
  return (
    <ScrollView
      contentContainerStyle={{
        padding: theme.spacing.lg,
        paddingBottom: theme.spacing.xxl,
        gap: theme.spacing.xl,
        maxWidth: theme.sizes.contentWidth,
        width: '100%',
        alignSelf: 'center',
      }}
    >
      <Stack gap="xs">
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
        <AppText variant="title">{title}</AppText>
      </Stack>
      {children}
    </ScrollView>
  );
}
