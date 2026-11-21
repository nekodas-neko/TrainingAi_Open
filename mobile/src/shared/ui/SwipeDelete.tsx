import type { PropsWithChildren } from 'react';
import { useTheme } from '../theme/ThemeProvider';
import { SwipeReveal, type SwipeRevealAction } from './SwipeReveal';

export function SwipeDelete({
  label,
  onDelete,
  onEdit,
  children,
}: PropsWithChildren<{ label: string; onDelete: () => void; onEdit?: () => void }>) {
  const { theme } = useTheme();
  const actions: SwipeRevealAction[] = [
    ...(onEdit
      ? [
          {
            key: 'edit',
            label: 'Edit',
            accessibilityLabel: `Edit ${label}`,
            icon: 'edit' as const,
            foreground: theme.colors.brandText,
            background: theme.colors.brandSurface,
            onPress: onEdit,
          },
        ]
      : []),
    {
      key: 'delete',
      label: 'Delete',
      accessibilityLabel: `Delete ${label}`,
      icon: 'delete',
      foreground: theme.colors.background,
      background: theme.colors.danger,
      onPress: onDelete,
    },
  ];
  return <SwipeReveal actions={actions}>{children}</SwipeReveal>;
}
