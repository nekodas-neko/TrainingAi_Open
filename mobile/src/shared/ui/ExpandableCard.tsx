import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { Tone } from '../theme/theme';
import { AppText } from './AppText';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { Stack } from './Stack';
import { layoutMotion } from './layoutMotion';
import { useReducedMotion } from './useReducedMotion';
import { DisclosureIcon } from './DisclosureIcon';

export function ExpandableCard({
  title,
  subtitle,
  icon,
  tone = 'neutral',
  value,
  status,
  summary,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  icon: IconName;
  tone?: Tone;
  value?: string;
  status?: ReactNode;
  summary?: ReactNode;
}>) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  return (
    <Card tone={tone} style={{ gap: 0 }}>
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityValue={{ text: [value, subtitle].filter(Boolean).join(', ') }}
          accessibilityHint={expanded ? 'Collapse details' : 'Expand details'}
          accessibilityState={{ expanded }}
          onPress={() => {
            layoutMotion(reduced);
            setExpanded((value) => !value);
          }}
          style={({ pressed }) => ({
            minHeight: theme.sizes.touchTarget,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <Icon
            name={icon}
            color={theme.tones[tone].foreground}
            size={theme.sizes.iconSmall}
            style={{ opacity: status ? 0 : 1 }}
          />
          <Stack gap="xxs" style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="label">{title}</AppText>
            {!!subtitle && (
              <AppText variant="caption" tone="muted">
                {subtitle}
              </AppText>
            )}
          </Stack>
          {value !== undefined && (
            <AppText variant="hero" style={{ fontVariant: ['tabular-nums'] }}>
              {value}
            </AppText>
          )}
          <DisclosureIcon expanded={expanded} />
        </Pressable>
        {!!status && (
          <View
            style={{
              position: 'absolute',
              left: -theme.spacing.md,
              top: '50%',
              transform: [{ translateY: -theme.sizes.touchTarget / 2 }],
            }}
          >
            {status}
          </View>
        )}
      </View>
      {summary && <View style={{ marginTop: theme.spacing.sm }}>{summary}</View>}
      {expanded && (
        <Stack
          gap="md"
          style={{
            marginTop: theme.spacing.md,
            paddingTop: theme.spacing.md,
            borderTopWidth: 1,
            borderTopColor: theme.tones[tone].border,
          }}
        >
          {children}
        </Stack>
      )}
    </Card>
  );
}
