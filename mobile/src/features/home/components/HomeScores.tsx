import { ScoreChip, Stack } from "../../../shared/ui";
import { useTheme } from "../../../shared/theme/ThemeProvider";
import { useHealthData } from "../../health/data/HealthDataProvider";
import { readinessSpec } from "../../health/data/models";
import { useWorkoutResource } from "../../workouts/data/WorkoutDataProvider";
import type { HealthDetail } from "../../health/screens/HealthDetailScreen";
import { useHome } from "../data/HomeProvider";
import { shiftDateStr } from "@trainingai/shared/date-utils";
export function HomeScores({
  onOpen,
}: {
  onOpen: (detail: HealthDetail) => void;
}) {
  const { theme } = useTheme();
  const health = useHealthData();
  const home = useHome();
  const { data } = useWorkoutResource(readinessSpec(health.today));
  const resting = data?.restingHrLastNight != null || data?.restingHr != null;
  const night = health.sleep.find(
    (row) =>
      row.date === health.today || row.date === shiftDateStr(health.today, -1),
  );
  const duration = data?.sleepScore == null ? night?.durationHours : null;
  return (
    <Stack
      direction="row"
      gap={
        ["rail", "duorail"].includes(home.preferences.scoreRingStyle ?? "")
          ? "none"
          : "xs"
      }
      style={
        ["rail", "duorail"].includes(home.preferences.scoreRingStyle ?? "")
          ? {
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.card,
              backgroundColor: theme.colors.raised,
              overflow: "hidden",
            }
          : undefined
      }
    >
      <ScoreChip
        label="Readiness"
        shortLabel="Ready"
        first
        value={data?.readinessDisplayScore ?? null}
        icon="power"
        tone="recovery"
        color={theme.scores.readiness}
        qualified={data?.limited || data?.isLowWearToday}
        style={home.preferences.scoreRingStyle}
        onPress={() => onOpen("readiness")}
      />
      <ScoreChip
        label={resting ? "Resting HR" : "Heart Rate"}
        shortLabel={resting ? "Rest HR" : "HR"}
        value={
          data?.restingHrLastNight ?? data?.restingHr ?? data?.hrCurrent ?? null
        }
        icon="cardio"
        tone="heart"
        color={theme.scores.heart}
        style={home.preferences.scoreRingStyle}
        onPress={() => onOpen("heart-rate")}
      />
      <ScoreChip
        label={duration != null ? "Sleep (h)" : "Sleep"}
        shortLabel="Sleep"
        value={data?.sleepScore ?? null}
        display={duration != null ? duration.toFixed(1) : undefined}
        icon="moon"
        tone="sleep"
        color={theme.scores.sleep}
        style={home.preferences.scoreRingStyle}
        qualified={
          health.sleep.find((night) => night.date === health.today)
            ?.provisional ||
          (data?.sleepScoreCoverage != null &&
            data.sleepScoreCoverage.level !== "full")
        }
        onPress={() => onOpen("sleep")}
      />
      <ScoreChip
        label="Activity"
        shortLabel="Move"
        value={data?.activityScore ?? null}
        icon="flame"
        tone="activity"
        color={theme.scores.activity}
        style={home.preferences.scoreRingStyle}
        onPress={() => onOpen("activity")}
      />
    </Stack>
  );
}
