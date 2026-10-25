import type { PropsWithChildren, ReactNode } from 'react';
import { View } from 'react-native';
import { AppText, IconButton, PageLayout, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { SessionTimer } from './WorkoutClocks';
import type { WorkoutRecord } from '../logging/workout';

export function WorkoutLayout({
  title,
  subtitle,
  detail,
  onBack,
  backIcon = 'back',
  backLabel = 'Back to session',
  workout,
  ring = false,
  actions,
  titleAction,
  footer,
  contentDisabled = false,
  reorderable = false,
  fillBottom = false,
  centeredTitle = false,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  detail?: string;
  onBack?: () => void;
  backIcon?: 'back' | 'forward';
  backLabel?: string;
  workout?: WorkoutRecord;
  ring?: boolean;
  actions?: ReactNode;
  titleAction?: ReactNode;
  footer?: ReactNode;
  contentDisabled?: boolean;
  reorderable?: boolean;
  fillBottom?: boolean;
  /** The title centred between the back button and the actions, with no rule under the header. */
  centeredTitle?: boolean;
}>) {
  const { theme } = useTheme();
  return (
    <PageLayout
      title={title}
      onBack={onBack}
      scroll
      reorderable={reorderable}
      fillBottom={fillBottom}
      landing={centeredTitle}
      footer={footer}
      header={
        <Stack direction="row" align="center" gap="sm">
          {onBack && <IconButton icon={backIcon} label={backLabel} onPress={onBack} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText
              variant={centeredTitle ? 'headerTitle' : ring ? 'caption' : 'heading'}
              numberOfLines={1}
              style={{ textAlign: ring || centeredTitle ? 'center' : 'left' }}
            >
              {title}
            </AppText>
            {subtitle && (
              <AppText
                numberOfLines={1}
                variant={ring ? 'micro' : 'caption'}
                tone="muted"
                style={{ textAlign: ring ? 'center' : 'left' }}
              >
                {subtitle}
              </AppText>
            )}
            {detail && (
              <AppText variant="caption" tone="muted">
                {detail}
              </AppText>
            )}
          </View>
          {titleAction}
          {centeredTitle ? (
            // Holds the back button's width on the right so the title stays centred.
            <View style={{ minWidth: theme.sizes.touchTarget, alignItems: 'flex-end' }}>{actions}</View>
          ) : (
            actions
          )}
          {workout && <SessionTimer workout={workout} ring={ring} />}
        </Stack>
      }
    >
      {contentDisabled ? (
        <Stack gap="md" pointerEvents="none">
          {children}
        </Stack>
      ) : (
        children
      )}
    </PageLayout>
  );
}
