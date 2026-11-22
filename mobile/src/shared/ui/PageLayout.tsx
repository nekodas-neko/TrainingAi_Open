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
import { Stack } from './Stack';
import { PageHeader } from './PageHeader';
import { useTheme } from '../theme/ThemeProvider';
import { ReorderScrollView } from './ReorderScrollView';
import { NestedScrollGesture, useNestedScrollBoundary } from './NestedScrollGesture';

export function PageLayout({
  title,
  subtitle,
  detail,
  actions,
  titleAction,
  headerTrailing,
  children,
  hideHeader = false,
  scroll = false,
  footer,
  floatingAction,
  contentStyle,
  onBack,
  onSystemBack,
  backLabel,
  backIcon,
  landing = false,
  reorderable = false,
  fillBottom = false,
}: PropsWithChildren<{
  title: string;
  subtitle?: ReactNode;
  detail?: string;
  actions?: ReactNode;
  titleAction?: ReactNode;
  /** Drawn at the right end of the header, after the actions (the workout timer). */
  headerTrailing?: ReactNode;
  hideHeader?: boolean;
  scroll?: boolean;
  footer?: ReactNode;
  floatingAction?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  onBack?: () => void;
  /** Android Back, when it must differ from the header's Back icon (the workout summary, #3879). */
  onSystemBack?: () => void;
  /** Spoken for the Back icon; "Back" unless Back goes somewhere named. */
  backLabel?: string;
  backIcon?: 'back' | 'forward';
  landing?: boolean;
  reorderable?: boolean;
  fillBottom?: boolean;
}>) {
  const { theme } = useTheme();
  const nestedScroll = useNestedScrollBoundary();
  useAndroidBack(onSystemBack ?? onBack);
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
      {hideHeader ? null : (
        <PageHeader
          title={title}
          subtitle={subtitle}
          detail={detail}
          actions={actions}
          titleAction={titleAction}
          trailing={headerTrailing}
          onBack={onBack}
          backLabel={backLabel}
          backIcon={backIcon}
          landing={landing}
        />
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
