import type { BodyBatteryLabel } from "@trainingai/shared/health/body-battery-band";
import { useTheme } from "../../../shared/theme/ThemeProvider";
import { AppText, Card, ProgressBar, Stack } from "../../../shared/ui";
import { energySpec } from "../../health/data/models";
import { useWorkoutResource } from "../../workouts/data/WorkoutDataProvider";
import { batteryColor, dayTotalFigures } from "../data/display";
import { useNutrition } from "../data/NutritionProvider";
import { useRecordedIntake } from "../data/useRecordedIntake";

/**
 * End of Day's "Today's totals": calories against the day's budget with what is left, the three
 * macros against their targets, and the Body Battery pill with how much it drained. Same content as
 * the current app's day summary. Calories are the counted intake (logged food plus the plan meals
 * counted as estimated, #2949), so the sheet agrees with the energy ring. The budget is the energy
 * balance's own (never the typed goal), and with none the card says kcal only.
 */
export function DayTotals({
  date,
  battery,
}: {
  date: string;
  battery: { current: number; label: string; drained: number } | null;
}) {
  const n = useNutrition(date);
  const { theme } = useTheme();
  const energy = useWorkoutResource(energySpec(date));
  const totals = n.view.totals;
  const data = energy.data?.date === date ? energy.data : null;
  const resolved = useRecordedIntake(date, data?.balance);
  const targets = data?.macroTargets?.scaled ?? n.view.targets;
  if (!totals) {
    return <AppText tone="muted">Food records are unavailable.</AppText>;
  }
  const { calories, budget, remaining, fraction } = dayTotalFigures({
    loggedKcal: totals.calories,
    intake: resolved.intake,
    budget: data?.balance?.budgetKcal ?? null,
  });
  const colors = {
    proteinG: theme.macros.protein,
    carbsG: theme.macros.carbs,
    fatG: theme.macros.fat,
  };
  const tint = battery
    ? batteryColor(battery.label as BodyBatteryLabel, theme)
    : null;
  return (
    <Stack>
      <Stack gap="xs">
        <Stack direction="row" justify="space-between" align="baseline">
          <AppText variant="label" style={{ fontVariant: ["tabular-nums"] }}>
            {Math.round(calories).toLocaleString()}
            <AppText variant="caption" tone="muted">
              {budget != null
                ? ` / ${Math.round(budget).toLocaleString()} kcal`
                : " kcal"}
            </AppText>
          </AppText>
          {remaining != null && (
            <AppText
              variant="caption"
              tone="muted"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {remaining > 0
                ? `${Math.round(remaining).toLocaleString()} left`
                : "Goal reached"}
            </AppText>
          )}
        </Stack>
        {fraction != null && <ProgressBar value={fraction} />}
      </Stack>
      <Stack direction="row" justify="space-between">
        {(["proteinG", "carbsG", "fatG"] as const).map((key, i) => (
          <Stack key={key} gap="xxs">
            <AppText variant="micro" style={{ color: colors[key] }}>
              {["Protein", "Carbs", "Fat"][i]}
            </AppText>
            <AppText variant="label" style={{ fontVariant: ["tabular-nums"] }}>
              {Math.round(totals[key])}
              {targets[key] != null && (
                <AppText variant="caption" tone="muted">
                  /{Math.round(targets[key]!)}
                </AppText>
              )}{" "}
              g
            </AppText>
          </Stack>
        ))}
      </Stack>
      {battery && tint && (
        <Stack
          direction="row"
          align="center"
          gap="sm"
          style={{
            alignSelf: "flex-start",
            borderWidth: 1,
            borderColor: tint,
            borderRadius: theme.radii.control,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
          }}
        >
          <AppText variant="micro" style={{ color: tint }}>
            Body Battery · {battery.label}
          </AppText>
          <AppText variant="label" style={{ color: tint }}>
            {battery.current}
          </AppText>
          {battery.drained > 0 && (
            <AppText variant="micro" tone="danger">
              down {Math.round(battery.drained)}
            </AppText>
          )}
        </Stack>
      )}
    </Stack>
  );
}
