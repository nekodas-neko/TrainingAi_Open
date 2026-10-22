import type { ReactNode } from 'react';
import { AppText, Icon, Stack, type IconName } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { ResourceStatus } from '../../workouts/components/ResourceStatus';
import type { ResourceState } from '../../workouts/data/WorkoutResources';

export function HealthResourceHeader({
  title,
  state,
  refresh,
  icon,
  iconColor,
  caption,
  trailing,
}: {
  title: string;
  /** A brand-coloured glyph before the title, as the current app's AI Periodization card has. */
  icon?: IconName;
  iconColor?: string;
  /** Small muted text at the right of the title row. */
  caption?: string;
  /** A control at the right of the title row, before the refresh status (a Today | This Week toggle). */
  trailing?: ReactNode;
  state: ResourceState & { connected?: boolean };
  refresh: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Stack direction="row" justify="space-between" align="center">
      <Stack direction="row" align="center" gap="xs" style={{ flex: 1, minWidth: 0 }}>
        {icon && <Icon name={icon} tone="brand" color={iconColor} size={theme.sizes.iconSmall} />}
        <AppText
          variant="cardTitle"
          tone="muted"
          accessibilityRole="header"
          style={{ flexShrink: 1 }}
        >
          {title}
        </AppText>
      </Stack>
      {caption && (
        <AppText variant="micro" tone="muted">
          {caption}
        </AppText>
      )}
      {trailing}
      <ResourceStatus inline label={title} state={state} refresh={refresh} />
    </Stack>
  );
}
