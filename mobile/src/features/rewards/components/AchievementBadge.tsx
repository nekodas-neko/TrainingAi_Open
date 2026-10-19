import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AppText, Icon } from '../../../shared/ui';
import { useReducedMotion } from '../../../shared/ui/useReducedMotion';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { Achievement } from '../data/models';
import { tierOf } from '../data/view';
import { achievementIcon } from './achievementIcons';
import { useCategoryColor } from './useCategoryColor';
import { tint } from './tint';
import { glow } from './glow';

/** One tile of the achievement grid: icon, name, tier, lock and progress as the current app draws it. */
export function AchievementBadge({
  achievement,
  isNew = false,
  onPress,
}: {
  achievement: Achievement;
  isNew?: boolean;
  onPress: (achievement: Achievement) => void;
}) {
  const { theme } = useTheme();
  const { id, unlocked, progress, name, category } = achievement;
  const color = useCategoryColor(category);
  const tier = tierOf(achievement);
  const border = tier ? theme.rewards.tiers[tier] : theme.colors.border;
  const [width, setWidth] = useState(0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${unlocked ? 'unlocked' : 'locked'}${isNew ? ', new' : ''}`}
      onPress={() => onPress(achievement)}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={({ pressed }) => ({
        ...(tier
          ? glow(border, tier === 'gold' ? 12 : 8, tier === 'gold' ? 0.5 : 0.35)
          : null),
        aspectRatio: 1,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: theme.radii.card,
        borderWidth: tier === 'gold' ? 2 : 1,
        borderColor: unlocked ? (tier ? border : color) : theme.colors.border,
        backgroundColor: unlocked ? tint(color, 0.12) : theme.colors.raised,
        padding: theme.spacing.sm,
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      {tier === 'gold' && (
        <View
          style={{
            position: 'absolute',
            top: theme.spacing.xs,
            left: theme.spacing.xs,
            borderRadius: theme.radii.small / 2,
            backgroundColor: tint(border, 0.15),
            paddingHorizontal: theme.spacing.xs,
          }}
        >
          <AppText variant="eyebrow" style={{ color: border }}>
            Gold
          </AppText>
        </View>
      )}
      <Icon
        name={achievementIcon(id)}
        size={theme.sizes.emphasizedIcon + theme.spacing.xs}
        color={unlocked ? color : theme.colors.muted}
      />
      <AppText
        variant="micro"
        numberOfLines={2}
        style={{
          color: unlocked ? color : theme.colors.muted,
          textAlign: 'center',
          marginTop: theme.spacing.xs,
        }}
      >
        {name}
      </AppText>
      {!unlocked && (
        <View
          style={{
            position: 'absolute',
            top: theme.spacing.xs,
            right: theme.spacing.xs,
            opacity: 0.4,
          }}
        >
          <Icon name="lock" size={theme.spacing.sm + theme.spacing.xxs} tone="muted" />
        </View>
      )}
      {!unlocked && progress > 0 && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: theme.spacing.xs + theme.spacing.xxs,
            backgroundColor: theme.colors.track,
          }}
        >
          <View
            style={{
              height: '100%',
              width: `${Math.round(progress * 100)}%`,
              backgroundColor: color,
            }}
          />
        </View>
      )}
      {isNew && width > 0 && <Shimmer width={width} />}
    </Pressable>
  );
}

// shimmer-sweep: a light band crossing a newly unlocked tile, twice over 1.2 s each. Reduced motion
// draws nothing, as the current app's `prefers-reduced-motion` rule does.
function Shimmer({ width }: { width: number }) {
  const reduced = useReducedMotion();
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const animation = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
      { iterations: 2 },
    );
    animation.start();
    return () => animation.stop();
  }, [reduced, sweep]);
  if (reduced) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        width,
        transform: [
          {
            translateX: sweep.interpolate({
              inputRange: [0, 1],
              outputRange: [-width, width],
            }),
          },
        ],
      }}
    >
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0.4" stopColor="#ffffff" stopOpacity="0" />
            <Stop offset="0.5" stopColor="#ffffff" stopOpacity="0.35" />
            <Stop offset="0.6" stopColor="#ffffff" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#sweep)" />
      </Svg>
    </Animated.View>
  );
}
