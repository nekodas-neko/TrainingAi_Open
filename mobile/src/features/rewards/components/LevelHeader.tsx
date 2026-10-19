import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText, ProgressBar, Stack } from "../../../shared/ui";
import { useTheme } from "../../../shared/theme/ThemeProvider";
import type { Rewards } from "../data/models";
import { levelHeadline, levelProgress } from "../data/view";
import { LevelSheet } from "./LevelSheet";

/** More › Profile: the level badge (opens Level & XP) and the XP bar under it. */
export function LevelHeader({
  rewards,
  failed,
}: {
  rewards: Rewards | null;
  failed: boolean;
}) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const headline = rewards ? levelHeadline(rewards) : null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          headline
            ? `${headline.title}, ${rewards!.xp} XP total. Open Level and XP`
            : "Level and XP"
        }
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing.sm,
          minHeight: theme.sizes.touchTarget,
          borderRadius: theme.radii.card,
          borderWidth: 1,
          borderColor: theme.colors.brandBorder,
          backgroundColor: theme.colors.brandSurface,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
          transform: [{ scale: pressed ? 0.95 : 1 }],
        })}
      >
        <View
          style={{
            width: theme.sizes.foodThumbnail,
            height: theme.sizes.foodThumbnail,
            borderRadius: theme.radii.control,
            backgroundColor: theme.colors.brand,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AppText
            variant="subheading"
            style={{ color: theme.colors.onBrand, fontWeight: "900" }}
          >
            {rewards ? rewards.level : "—"}
          </AppText>
        </View>
        <View>
          <AppText variant="caption" tone="brand" style={{ fontWeight: "700" }}>
            {headline ? headline.title : "Level —"}
          </AppText>
          <AppText variant="micro" tone="muted">
            {headline ? headline.detail : "Tap for details"}
          </AppText>
        </View>
      </Pressable>
      {rewards && headline && (
        <View style={{ width: "100%", maxWidth: theme.sizes.summaryWidth }}>
          <ProgressBar value={levelProgress(rewards)} />
          <Stack
            direction="row"
            justify="space-between"
            style={{ paddingHorizontal: theme.spacing.xxs }}
          >
            <AppText
              variant="micro"
              tone="muted"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {headline.barStart}
            </AppText>
            <AppText
              variant="micro"
              tone="muted"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {headline.barEnd}
            </AppText>
          </Stack>
        </View>
      )}
      {failed && !rewards && (
        <AppText variant="caption" tone="muted" style={{ textAlign: "center" }}>
          Couldn’t load your stats — tap Retry above.
        </AppText>
      )}
      <LevelSheet
        visible={open}
        rewards={rewards}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
