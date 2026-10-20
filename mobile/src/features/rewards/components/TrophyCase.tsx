import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppButton, AppText, Card, Grid, Icon, Sheet, Stack } from '../../../shared/ui';
import { trophySlots } from '@trainingai/shared/achievement-display';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { Achievement } from '../data/models';
import { useTrophyCase } from '../data/useRewards';
import { achievementIcon } from './achievementIcons';
import { glow } from './glow';
import { blend } from './tint';
import { useCategoryColor } from './useCategoryColor';

function Slot({
  achievement,
  onPress,
  pending = false,
}: {
  achievement?: Achievement;
  onPress: () => void;
  /** Pins not read yet: an outline only, so a slot is never called Empty before it is known to be. */
  pending?: boolean;
}) {
  const { theme } = useTheme();
  const color = useCategoryColor(achievement?.category ?? '');
  if (!achievement) {
    return (
      <View
        accessibilityLabel={pending ? undefined : 'Empty trophy slot'}
        accessible={!pending}
        style={{
          aspectRatio: 1,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: theme.radii.card,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: theme.colors.border,
        }}
      >
        {!pending && (
          <>
            <Icon name="lock" size={theme.sizes.iconSmall} tone="muted" />
            <AppText
              variant="statUnit"
              tone="muted"
              style={{ marginTop: theme.spacing.xs }}
            >
              Empty
            </AppText>
          </>
        )}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${achievement.name}, in your trophy case`}
      onPress={onPress}
      style={({ pressed }) => [
        glow(color, 14, 0.3),
        {
          aspectRatio: 1,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: theme.radii.card,
          borderWidth: 1,
          borderColor: color,
          backgroundColor: blend(color, theme.colors.background, 0.12),
          padding: theme.spacing.md,
          transform: [{ scale: pressed ? 0.95 : 1 }],
        },
      ]}
    >
      <Icon
        name={achievementIcon(achievement.id)}
        size={theme.spacing.xxxl + theme.spacing.sm}
        color={color}
      />
      <AppText
        variant="micro"
        numberOfLines={2}
        style={{ color, textAlign: 'center', marginTop: theme.spacing.sm }}
      >
        {achievement.name}
      </AppText>
    </Pressable>
  );
}

function PickerTile({
  achievement,
  pinned,
  onPress,
}: {
  achievement: Achievement;
  pinned: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const color = useCategoryColor(achievement.category);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        pinned ? `${achievement.name}, pinned` : `Pin ${achievement.name}`
      }
      accessibilityState={{ disabled: pinned }}
      disabled={pinned}
      onPress={onPress}
      style={{
        aspectRatio: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radii.control,
        borderWidth: 1,
        borderColor: pinned ? theme.colors.brand : color,
        backgroundColor: blend(color, theme.colors.background, 0.1),
        opacity: pinned ? 0.4 : 1,
        padding: theme.spacing.sm,
      }}
    >
      <Icon
        name={achievementIcon(achievement.id)}
        size={theme.sizes.icon}
        color={color}
      />
      <AppText
        variant="statUnit"
        numberOfLines={2}
        style={{
          color,
          textAlign: 'center',
          fontWeight: '600',
          marginTop: theme.spacing.xs,
        }}
      >
        {achievement.name}
      </AppText>
    </Pressable>
  );
}

/** More › Profile › Trophy Case: three slots for achievements to show off, chosen on this phone. */
export function TrophyCase({ achievements }: { achievements: Achievement[] }) {
  const { theme } = useTheme();
  const { pinned, pin, unpin } = useTrophyCase();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Achievement | null>(null);
  const color = useCategoryColor(selected?.category ?? '');
  const slots = trophySlots(achievements, pinned ?? []);
  const unlocked = achievements.filter((row) => row.unlocked);
  return (
    <Card>
      <Stack direction="row" align="center" justify="space-between">
        <AppText variant="eyebrow" tone="muted">
          Trophy Case
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: editing }}
          onPress={() => setEditing((open) => !open)}
          style={{
            minHeight: theme.sizes.touchTarget,
            minWidth: theme.sizes.touchTarget,
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
        >
          <AppText variant="caption" tone="muted">
            {editing ? 'Done' : 'Edit'}
          </AppText>
        </Pressable>
      </Stack>
      <Grid columns={3} gap="snug">
        {slots.map((row, index) => (
          <Slot
            key={index}
            achievement={row}
            pending={pinned === null}
            onPress={() => row && setSelected(row)}
          />
        ))}
      </Grid>
      {editing && unlocked.length > 0 && (
        <Stack
          gap="md"
          style={{
            marginTop: theme.spacing.sm,
            paddingTop: theme.spacing.lg,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          <AppText variant="eyebrow" tone="muted">
            Pin an Achievement
          </AppText>
          <Grid columns={4} gap="sm">
            {unlocked.map((row) => (
              <PickerTile
                key={row.id}
                achievement={row}
                pinned={(pinned ?? []).includes(row.id)}
                onPress={() => {
                  pin(row.id);
                  setEditing(false);
                }}
              />
            ))}
          </Grid>
        </Stack>
      )}
      <Sheet
        visible={selected !== null}
        title={selected?.name ?? 'Achievement'}
        titleColor={color}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <AppText variant="caption" tone="muted">
              {selected.description}
            </AppText>
            <Stack direction="row" justify="space-between">
              <AppText variant="caption" tone="muted">
                Reward
              </AppText>
              <AppText variant="caption" style={{ color, fontWeight: '700' }}>
                +{selected.xpReward} XP
              </AppText>
            </Stack>
            <AppButton
              title="Remove from showcase"
              variant="surface"
              onPress={() => {
                unpin(selected.id);
                setSelected(null);
              }}
            />
          </>
        )}
      </Sheet>
    </Card>
  );
}
