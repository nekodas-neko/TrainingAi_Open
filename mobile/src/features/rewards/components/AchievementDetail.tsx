import { View } from "react-native";
import { AppText, ProgressBar, Sheet, Stack } from "../../../shared/ui";
import { useTheme } from "../../../shared/theme/ThemeProvider";
import type { Achievement } from "../data/models";
import { tierOf } from "../data/view";
import { useCategoryColor } from "./useCategoryColor";
import { tint } from "./tint";

/** The popover on the current app's badge: description, progress toward the goal, the XP it pays. */
export function AchievementDetail({
  achievement,
  onClose,
}: {
  achievement: Achievement | null;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const color = useCategoryColor(achievement?.category ?? "");
  const tier = achievement ? tierOf(achievement) : null;
  const tierColor = tier ? theme.rewards.tiers[tier] : null;
  return (
    <Sheet
      visible={achievement !== null}
      title={achievement?.name ?? "Achievement"}
      onClose={onClose}
    >
      {achievement && (
        <>
          {tier && tierColor && (
            <View
              style={{
                alignSelf: "flex-start",
                borderRadius: theme.radii.small / 2,
                backgroundColor: tint(tierColor, 0.125),
                paddingHorizontal: theme.spacing.xs + theme.spacing.xxs,
              }}
            >
              <AppText variant="eyebrow" style={{ color: tierColor }}>
                {tier}
              </AppText>
            </View>
          )}
          <AppText variant="caption" tone="muted">
            {achievement.description}
          </AppText>
          <Stack gap="xs">
            <Stack direction="row" justify="space-between">
              <AppText variant="caption" tone="muted">
                Progress
              </AppText>
              <AppText
                variant="caption"
                style={{ fontWeight: "600", fontVariant: ["tabular-nums"] }}
              >
                {Math.min(
                  achievement.current,
                  achievement.goal,
                ).toLocaleString()}{" "}
                / {achievement.goal.toLocaleString()}
              </AppText>
            </Stack>
            <ProgressBar value={achievement.progress} color={color} />
          </Stack>
          <Stack direction="row" justify="space-between">
            <AppText variant="caption" tone="muted">
              Reward
            </AppText>
            <AppText variant="caption" style={{ color, fontWeight: "700" }}>
              +{achievement.xpReward} XP
            </AppText>
          </Stack>
        </>
      )}
    </Sheet>
  );
}
