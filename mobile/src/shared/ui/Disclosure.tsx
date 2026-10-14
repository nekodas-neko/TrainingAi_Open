import { useReducedMotion } from './useReducedMotion';
import { layoutMotion } from './layoutMotion';
import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { AppButton } from './AppButton';
import { Stack } from './Stack';
import { Pressable, View } from 'react-native';
import { AppText } from './AppText';
import { IconButton } from './IconButton';
import { Icon } from './Icon';
import { useTheme } from '../theme/ThemeProvider';

export function Disclosure({
  title,
  children,
  defaultOpen = false,
  leading,
  compact = false,
  subtitle,
  trailing,
  accessibilityLabel = title,
}: PropsWithChildren<{
  title: string;
  defaultOpen?: boolean;
  leading?: ReactNode;
  compact?: boolean;
  subtitle?: string;
  trailing?: ReactNode;
  accessibilityLabel?: string;
}>) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(defaultOpen);
  function toggle() {
    layoutMotion(reduced);
    setExpanded(!expanded);
  }
  return (
    <Stack>
      <Stack direction="row" align="center" gap="xs">
        {leading}
        {compact ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              accessibilityHint={subtitle}
              accessibilityState={{ expanded }}
              onPress={toggle}
              style={({ pressed }) => ({
                flex: 1,
                minWidth: 0,
                minHeight: theme.sizes.touchTarget,
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <AppText variant="label" numberOfLines={2}>{title}</AppText>
              {subtitle && (
                <AppText variant="caption" tone="muted" numberOfLines={2}>
                  {subtitle}
                </AppText>
              )}
            </Pressable>
            {trailing}
            <IconButton
              icon="expand"
              label={`${expanded ? 'Collapse' : 'Expand'} ${accessibilityLabel}`}
              expanded={expanded}
              onPress={toggle}
            >
              <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
                <Icon name="expand" tone="muted" size={theme.sizes.iconSmall} />
              </View>
            </IconButton>
          </>
        ) : (
          <AppButton
            title={title}
            variant="ghost"
            accessibilityState={{ expanded }}
            style={{ flex: 1 }}
            onPress={toggle}
          />
        )}
      </Stack>
      {expanded && children}
    </Stack>
  );
}
