import type { PropsWithChildren, ReactNode } from 'react';
import { AppText, PageLayout, Stack } from '../../../shared/ui';
import { breakAtSeparators } from '../../../shared/ui/PageHeader';
import { SessionTimer } from './WorkoutClocks';
import type { WorkoutRecord } from '../logging/workout';

export function WorkoutLayout({
  title,
  subtitle,
  subtitleNode,
  detail,
  onBack,
  onSystemBack,
  backIcon = 'back',
  backLabel,
  workout,
  actions,
  titleAction,
  footer,
  contentDisabled = false,
  reorderable = false,
  fillBottom = false,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  /** Drawn in the subtitle's place when given (the summary's "New Personal Record!", #3671). */
  subtitleNode?: ReactNode;
  detail?: string;
  onBack?: () => void;
  /** Android Back, when it must differ from the header button (the summary, #3879). */
  onSystemBack?: () => void;
  backIcon?: 'back' | 'forward';
  /** "Back" unless Back goes somewhere named: pass "Back to session" only where it does (#3760). */
  backLabel?: string;
  workout?: WorkoutRecord;
  actions?: ReactNode;
  titleAction?: ReactNode;
  footer?: ReactNode;
  contentDisabled?: boolean;
  reorderable?: boolean;
  fillBottom?: boolean;
}>) {
  return (
    <PageLayout
      title={title}
      onBack={onBack}
      onSystemBack={onSystemBack}
      subtitle={
        subtitleNode ??
        (subtitle && (
          <AppText variant="caption" tone="muted">
            {breakAtSeparators(subtitle)}
          </AppText>
        ))
      }
      detail={detail}
      scroll
      reorderable={reorderable}
      fillBottom={fillBottom}
      footer={footer}
      backIcon={backIcon}
      backLabel={backLabel}
      titleAction={titleAction}
      actions={actions}
      headerTrailing={workout && <SessionTimer workout={workout} />}
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
