import { ActionMenu } from './ActionMenu';
import { feedback } from '../../integrations/feedback/haptics';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { Tone } from '../theme/theme';
import { AppText } from './AppText';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';
import { Stack } from './Stack';

export function MetricCard({
  label,
  value,
  unit,
  caption,
  icon,
  tone = 'neutral',
  accent,
  dense = false,
  centered = false,
  onOpen,
  openLabel,
  onLog,
  status,
  children,
}: {
  label: string;
  value?: string | null;
  unit?: string;
  caption?: string;
  icon?: IconName;
  tone?: Tone;
  accent?: string;
  dense?: boolean;
  centered?: boolean;
  onOpen?: () => void;
  openLabel?: string;
  onLog?: () => void;
  status?: ReactNode;
  children?: ReactNode;
}) {
  const { theme } = useTheme();
  const [menu, setMenu] = useState(false);
  const [compact, setCompact] = useState(false);
  const canAct = !!onOpen || !!onLog;
  function more() {
    feedback('impact');
    setMenu(true);
  }
  const color = accent && accent !== 'transparent' ? accent : theme.tones[tone].foreground;
  const header = (
    <Stack
      direction="row"
      align="center"
      justify="space-between"
      style={{
        minHeight: dense
          ? (theme.typography.caption.lineHeight ?? theme.spacing.xl) * 2
          : theme.sizes.touchTarget,
      }}
    >
      <Stack
        direction="row"
        align="center"
        justify={centered ? 'center' : undefined}
        gap="xs"
        style={{ flex: 1, minWidth: 0 }}
      >
        {icon && <Icon name={icon} color={color} size={theme.sizes.iconSmall} />}
        <AppText
          variant="cardTitle"
          style={{ color, flexShrink: 1, textAlign: centered ? 'center' : 'left' }}
          numberOfLines={2}
        >
          {label}
        </AppText>
      </Stack>
      {status}
      {!dense && onLog && (
        <IconButton icon="plus" tone="brand" label={`Log ${label}`} onPress={onLog} />
      )}
    </Stack>
  );
  return (
    <>
      <Card
        onLayout={(event) =>
          setCompact(event.nativeEvent.layout.width < theme.sizes.compactMetricWidth)
        }
        tone={tone}
        accent={accent}
        style={{
          flexGrow: 1,
          padding: theme.spacing[dense ? 'md' : 'lg'],
          gap: theme.spacing[dense ? 'xs' : 'sm'],
        }}
      >
        {!dense && header}
        <Pressable
          disabled={!canAct}
          onPress={onOpen ?? onLog}
          onLongPress={canAct ? more : undefined}
          accessibilityActions={
            canAct ? [{ name: 'longpress', label: 'More actions' }] : undefined
          }
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'longpress') more();
          }}
          accessibilityRole={canAct ? 'button' : undefined}
          accessibilityValue={{
            text:
              value === null ? 'Unavailable' : [value, unit, caption].filter(Boolean).join(' '),
          }}
          accessibilityLabel={
            onOpen ? (openLabel ?? `View ${label} history`) : onLog ? `Log ${label}` : undefined
          }
          style={({ pressed }) => ({
            paddingRight: onOpen && !dense ? theme.sizes.iconSmall : 0,
            gap: theme.spacing.xs,
            opacity: pressed ? 0.65 : 1,
            minHeight:
              value !== undefined
                ? dense
                  ? theme.typography.hero.lineHeight
                  : theme.sizes.metricValue
                : undefined,
            justifyContent: 'center',
          })}
        >
          {dense && header}
          {value !== undefined && (
            <Stack
              direction="row"
              align="baseline"
              justify={centered ? 'center' : undefined}
              gap="xs"
              wrap={!dense}
            >
              <AppText
                variant={dense ? (compact ? 'heading' : 'hero') : 'title'}
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{
                  fontVariant: ['tabular-nums'],
                  flexShrink: 1,
                  textAlign: centered ? 'center' : 'left',
                }}
              >
                {value ?? '—'}
              </AppText>
              {!!unit && (
                <AppText variant={dense ? 'micro' : 'caption'} tone="muted">
                  {unit}
                </AppText>
              )}
            </Stack>
          )}
          {!!caption && (
            <AppText
              variant="caption"
              tone="muted"
              style={{ textAlign: centered ? 'center' : 'left' }}
            >
              {caption}
            </AppText>
          )}
          {!dense && onOpen && (
            <Icon
              name="forward"
              size={theme.sizes.iconSmall}
              tone="muted"
              style={{ position: 'absolute', right: 0, bottom: 0 }}
            />
          )}
        </Pressable>
        {children}
        {dense && (
          <View
            style={{
              marginTop: 'auto',
              minHeight: theme.sizes.touchTarget,
              justifyContent: 'center',
            }}
          >
            {onLog ? (
              <Pressable
                onPress={onLog}
                accessibilityRole="button"
                accessibilityLabel={`Log ${label}`}
                style={({ pressed }) => ({
                  minHeight: theme.sizes.touchTarget,
                  justifyContent: 'center',
                  opacity: pressed ? 0.65 : 1,
                })}
              >
                <Stack
                  direction="row"
                  align="center"
                  justify={centered ? 'center' : undefined}
                  gap="xs"
                >
                  <Icon name="plus" tone="brand" size={theme.sizes.iconSmall} />
                  <AppText variant="caption" tone="brand">
                    Log
                  </AppText>
                </Stack>
              </Pressable>
            ) : onOpen ? (
              <Pressable
                onPress={onOpen}
                accessibilityRole="button"
                accessibilityLabel={`View ${label}`}
                style={({ pressed }) => ({
                  minHeight: theme.sizes.touchTarget,
                  justifyContent: 'center',
                  opacity: pressed ? 0.65 : 1,
                })}
              >
                <Stack
                  direction="row"
                  align="center"
                  justify={centered ? 'center' : undefined}
                  gap="xs"
                >
                  <AppText variant="caption" tone="brand">
                    View
                  </AppText>
                  <Icon name="forward" tone="brand" size={theme.sizes.iconSmall} />
                </Stack>
              </Pressable>
            ) : null}
          </View>
        )}
      </Card>
      {menu && (
        <ActionMenu
          visible
          title={label}
          onClose={() => setMenu(false)}
          actions={[
            ...(onLog ? [{ title: `Log ${label}`, icon: 'plus' as const, run: onLog }] : []),
            ...(onOpen
              ? [{ title: openLabel ?? 'View history', icon: 'history' as const, run: onOpen }]
              : []),
          ]}
        />
      )}
    </>
  );
}
