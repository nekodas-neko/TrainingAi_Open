import { AppText, Icon, Stack, type IconName } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { ResourceStatus } from '../../workouts/components/ResourceStatus';
import type { ResourceState } from '../../workouts/data/WorkoutResources';

export function HealthResourceHeader({
  title,
  state,
  refresh,
  icon,
  caption,
}: {
  title: string;
  /** A brand-coloured glyph before the title, as the current app's AI Periodization card has. */
  icon?: IconName;
  /** Small muted text at the right of the title row. */
  caption?: string;
  state: ResourceState & { connected?: boolean };
  refresh: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Stack direction="row" justify="space-between" align="center">
      <Stack direction="row" align="center" gap="xs" style={{ flex: 1, minWidth: 0 }}>
        {icon && <Icon name={icon} tone="brand" size={theme.sizes.iconSmall} />}
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
      <ResourceStatus inline label={title} state={state} refresh={refresh} />
    </Stack>
  );
}
