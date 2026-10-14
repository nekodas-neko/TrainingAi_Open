import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { TouchSurface } from './TouchSurface';

export function ActionTile({
  title,
  caption,
  icon,
  onPress,
  disabled = false,
  layout = 'tile',
}: {
  title: string;
  caption?: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
  layout?: 'tile' | 'row';
}) {
  const { theme } = useTheme();
  return (
    <TouchSurface
      fill
      accessibilityRole="button"
      accessibilityLabel={[title, caption].filter(Boolean).join(', ')}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ flex: 1 }}
    >
      {layout === 'row' ? (
        <Card
          style={{
            flex: 1,
            minHeight: theme.sizes.button,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.md,
            gap: theme.spacing.sm,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Icon name={icon} tone="muted" size={theme.sizes.iconSmall} />
          <AppText variant="label" style={{ flex: 1 }} numberOfLines={1}>
            {title}
          </AppText>
          {caption && (
            <AppText variant="label" tone="muted">
              {caption}
            </AppText>
          )}
        </Card>
      ) : (
        <Card
          style={{
            flex: 1,
            minHeight: theme.sizes.actionTile,
            alignItems: 'center',
            justifyContent: 'center',
            padding: theme.spacing.md,
            gap: theme.spacing.xs,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Icon name={icon} tone="brand" />
          <AppText variant="caption" style={{ textAlign: 'center' }}>
            {title}
          </AppText>
          {caption && (
            <AppText variant="micro" tone="muted" style={{ textAlign: 'center' }}>
              {caption}
            </AppText>
          )}
        </Card>
      )}
    </TouchSurface>
  );
}
