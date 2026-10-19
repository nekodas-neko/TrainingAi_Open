import { View } from "react-native";
import { AppText, ProgressBar, Sheet, Stack } from "../../../shared/ui";
import { useTheme } from "../../../shared/theme/ThemeProvider";
import type { Rewards } from "../data/models";
import {
  levelProgress,
  levelRows,
  levelSheetHero,
  xpSources,
} from "../data/view";

/** The current app's Level & XP sheet: hero, all levels, then where the XP came from. */
export function LevelSheet({
  visible,
  rewards,
  onClose,
}: {
  visible: boolean;
  rewards: Rewards | null;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  // Before the first read the sheet shows the same defaults the current app falls back to.
  const view = rewards ?? {
    level: 1,
    xp: 0,
    currentLevelXp: 0,
    nextLevelXp: 100,
    achievements: [],
  };
  const hero = levelSheetHero(view);
  const sources = xpSources(view.achievements);
  return (
    <Sheet visible={visible} title="Level & XP" onClose={onClose}>
      <Stack align="center" gap="md">
        <View
          style={{
            width: theme.sizes.demonstration,
            height: theme.sizes.demonstration,
            borderRadius: theme.radii.card,
            backgroundColor: theme.colors.brand,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AppText
            variant="hero"
            style={{ color: theme.colors.onBrand, fontWeight: "900" }}
          >
            {view.level}
          </AppText>
        </View>
        <View style={{ alignItems: "center" }}>
          <AppText variant="heading" tone="brand" style={{ fontWeight: "700" }}>
            {hero.label}
          </AppText>
          <AppText variant="body" tone="muted">
            {hero.total}
          </AppText>
        </View>
        <View style={{ width: "100%", maxWidth: theme.sizes.summaryWidth }}>
          <Stack direction="row" justify="space-between">
            <AppText variant="micro" tone="muted">
              {hero.start}
            </AppText>
            <AppText variant="micro" tone="muted">
              {hero.end}
            </AppText>
          </Stack>
          <ProgressBar value={levelProgress(view)} height={theme.spacing.md} />
        </View>
      </Stack>
      <Stack gap="sm">
        <AppText variant="eyebrow" tone="muted">
          All Levels
        </AppText>
        {levelRows(view.level).map((row) => {
          const reached = row.state !== "upcoming";
          return (
            <Stack
              key={row.level}
              direction="row"
              align="center"
              gap="md"
              accessible
              accessibilityLabel={`Level ${row.level}, ${row.label}, ${row.threshold.toLocaleString()} XP${row.state === "current" ? ", current level" : row.state === "past" ? ", reached" : ""}`}
              style={{
                borderRadius: theme.radii.control,
                borderWidth: 1,
                borderColor:
                  row.state === "current"
                    ? theme.colors.brand
                    : theme.colors.border,
                backgroundColor:
                  row.state === "current"
                    ? theme.colors.brandSurface
                    : "transparent",
                opacity: row.state === "past" ? 0.55 : 1,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
              }}
            >
              <View
                style={{
                  width: theme.sizes.foodThumbnail,
                  height: theme.sizes.foodThumbnail,
                  borderRadius: theme.radii.control,
                  backgroundColor: reached
                    ? theme.colors.brand
                    : theme.colors.raised,
                  opacity: row.state === "past" ? 0.6 : 1,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <AppText
                  variant="subheading"
                  style={{
                    color: reached ? theme.colors.onBrand : theme.colors.muted,
                    fontWeight: "900",
                  }}
                >
                  {row.level}
                </AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="subheading">{row.label}</AppText>
                <AppText variant="micro" tone="muted">
                  {row.threshold.toLocaleString()} XP
                </AppText>
              </View>
              {row.state === "current" && (
                <View
                  style={{
                    borderRadius: theme.radii.small,
                    backgroundColor: theme.colors.brand,
                    paddingHorizontal: theme.spacing.sm,
                    paddingVertical: theme.spacing.xs,
                  }}
                >
                  <AppText
                    variant="micro"
                    style={{ color: theme.colors.onBrand }}
                  >
                    Current
                  </AppText>
                </View>
              )}
              {row.state === "past" && (
                <AppText variant="micro" tone="muted">
                  ✓
                </AppText>
              )}
            </Stack>
          );
        })}
      </Stack>
      {sources.length > 0 && (
        <Stack gap="xs">
          <AppText variant="eyebrow" tone="muted">
            XP Sources ({sources.length} unlocked)
          </AppText>
          {sources.map((row) => (
            <Stack key={row.id} direction="row" align="center" gap="sm">
              <AppText tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                {row.name}
              </AppText>
              <AppText
                variant="subheading"
                tone="brand"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                +{row.xpReward}
              </AppText>
            </Stack>
          ))}
        </Stack>
      )}
    </Sheet>
  );
}
