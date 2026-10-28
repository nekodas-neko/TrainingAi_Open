import type { ReactNode } from 'react';
import { AppText, Icon, Stack, type IconName } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { ResourceStatus } from '../../workouts/components/ResourceStatus';
import type { ResourceState } from '../../workouts/data/WorkoutResources';
import { statusVisible } from '../data/status-visible';

export function HealthResourceHeader({
  title,
  state,
  refresh,
  icon,
  iconColor,
  caption,
  trailing,
  status = 'when-active',
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
  /** 'when-active' (the default) keeps the status's 48 px slot out of the row until it is loading or has failed; the current app's card headers have none. */
  status?: 'always' | 'when-active';
}) {
  const { theme } = useTheme();
  return (
    <Stack direction="row" justify="space-between" align="center">
      <Stack direction="row" align="center" gap="xs" style={{ flex: 1, minWidth: 0 }}>
        {icon && <Icon name={icon} tone="brand" color={iconColor} size={theme.sizes.iconCompact} />}
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
        <AppText variant="micro" tone="muted" style={{ fontWeight: '400' }}>
          {caption}
        </AppText>
      )}
      {trailing}
      {(status === 'always' || statusVisible(state)) && (
        <ResourceStatus inline label={title} state={state} refresh={refresh} />
      )}
    </Stack>
  );
}
