import type { PropsWithChildren, ReactNode } from 'react';
import { View } from 'react-native';
import { AppText, IconButton, PageLayout, Stack } from '../../../shared/ui';
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
  footer,
  contentDisabled = false,
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
  footer?: ReactNode;
  contentDisabled?: boolean;
}>) {
  return (
    <PageLayout
      title={title}
      onBack={onBack}
      scroll
      footer={footer}
      header={
        <Stack direction="row" align="center" gap="sm">
          {onBack && <IconButton icon={backIcon} label={backLabel} onPress={onBack} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText
              variant={ring ? 'caption' : 'heading'}
              numberOfLines={1}
              style={{ textAlign: ring ? 'center' : 'left' }}
            >
              {title}
            </AppText>
            {subtitle && (
              <AppText
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
          {actions}
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
