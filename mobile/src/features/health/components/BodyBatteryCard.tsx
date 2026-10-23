import { useTheme } from "../../../shared/theme/ThemeProvider";
import { formatTimeOfDay } from "@trainingai/shared/date-utils";
import type { BodyBatteryLabel } from "@trainingai/shared/health/body-battery-band";
import {
  BODY_BATTERY_EXPLAINER,
  BODY_BATTERY_PROVISIONAL_SUFFIX,
  BODY_BATTERY_SPARSE_DAY,
  BODY_BATTERY_TREND_LABEL,
  bodyBatteryAnchorSuffix,
} from "@trainingai/shared/health/body-battery-copy";
import { useState } from "react";
import { Pressable, View } from "react-native";
import {
  AppText,
  Badge,
  Card,
  DisclosureIcon,
  Grid,
  Icon,
  LineChart,
  MetricTile,
  ProgressBar,
  Stack,
  StatusIndicator,
} from "../../../shared/ui";
import { useHealthData } from "../data/HealthDataProvider";
import { batterySpec, metricValue } from "../data/models";
import { useWorkoutResource } from "../../workouts/data/WorkoutDataProvider";
import { StressDayCard } from "./StressDayCard";
import { layoutMotion } from "../../../shared/ui/layoutMotion";
import { useReducedMotion } from "../../../shared/ui/useReducedMotion";
import { batteryColor } from "../../../shared/battery-color";

export function BodyBatteryCard() {
  const { theme } = useTheme();
  const health = useHealthData();
  const state = useWorkoutResource(batterySpec(health.today));
  const data = state.data;
  const lowData =
    !!data?.hasData && !!data.confidence && !data.confidence.sufficient;
  const color = batteryColor((data?.label ?? "Good") as BodyBatteryLabel, {
    colors: theme.colors,
    tones: theme.tones,
    status: theme.status,
  });
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const noData = !data?.hasData;
  const levelLabel = data?.hasData
    ? data.label
    : data
      ? "No data yet"
      : "Waiting for readings";
  const status =
    (state.loading && !data) || state.error ? (
      <StatusIndicator
        label="Body Battery"
        busy={state.loading && !data}
        error={state.error}
        onRetry={state.refresh}
      />
    ) : null;
  const trend = data?.hasData ? data.trend : null;
  const trendColor =
    trend === "charging"
      ? theme.status.success
      : trend === "draining"
        ? theme.status.danger
        : theme.colors.muted;
  return (
    <Card tone="brand" padded={false} style={{ gap: 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Body Battery"
        accessibilityValue={{
          text: [
            data?.hasData ? metricValue(data.current) : undefined,
            levelLabel,
          ]
            .filter(Boolean)
            .join(", "),
        }}
        accessibilityHint={expanded ? "Collapse details" : "Expand details"}
        accessibilityState={{ expanded }}
        onPress={() => {
          layoutMotion(reduced);
          setExpanded((value) => !value);
        }}
        style={({ pressed }) => ({
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.snug,
          gap: theme.spacing.sm,
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
          }}
        >
          <Icon
            name="battery"
            size={theme.sizes.iconCompact}
            color={noData ? theme.colors.muted : color}
          />
          <AppText
            variant="statLabel"
            tone="muted"
            style={{ fontWeight: "600" }}
          >
            Body Battery
          </AppText>
          <AppText
            variant="subheading"
            numberOfLines={1}
            style={{ flexShrink: 1, color: noData ? theme.colors.text : color }}
          >
            {levelLabel}
          </AppText>
          <View style={{ flex: 1 }} />
          {status}
          {lowData && <Badge label="Limited data" />}
          {trend && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing.xxs,
              }}
            >
              <Icon
                name={
                  trend === "charging"
                    ? "up"
                    : trend === "draining"
                      ? "down"
                      : "minus"
                }
                size={theme.sizes.iconCompact - theme.spacing.xs}
                color={trendColor}
              />
              <AppText variant="micro" style={{ color: trendColor }}>
                {BODY_BATTERY_TREND_LABEL[trend]}
              </AppText>
            </View>
          )}
          <AppText
            variant="weekTileValue"
            style={{
              fontVariant: ["tabular-nums"],
              color: noData ? theme.colors.text : color,
            }}
          >
            {data?.hasData ? metricValue(data.current) : "—"}
          </AppText>
          <DisclosureIcon expanded={expanded} />
        </View>
        {data && (
          <>
            <AppText variant="micro" tone="muted" style={{ fontWeight: "400" }}>
              {BODY_BATTERY_EXPLAINER}
            </AppText>
            <ProgressBar
              value={data.hasData ? data.current / 100 : 0}
              origin="right"
              color={color}
            />
          </>
        )}
      </Pressable>
      {expanded && (
        <Stack
          gap="md"
          style={{
            paddingHorizontal: theme.spacing.md,
            paddingTop: theme.spacing.md,
            paddingBottom: theme.spacing.md,
            borderTopWidth: 1,
            borderTopColor: theme.tones.brand.border,
          }}
        >
          {data ? (
            <>
              {data.hasData ? (
                <>
                  <LineChart
                    label="Body Battery today"
                    domain={[0, 100]}
                    fill
                    points={data.series.map((point) => ({
                      label: formatTimeOfDay(point.t, health.timezone),
                      value: point.v,
                      x: point.t,
                    }))}
                  />
                  <AppText variant="caption" tone="muted">
                    Started at {data.anchor}
                    {bodyBatteryAnchorSuffix(data.anchorSource)}
                    {data.anchorProvisional
                      ? BODY_BATTERY_PROVISIONAL_SUFFIX
                      : ""}
                  </AppText>
                  <Grid columns={2}>
                    <MetricTile label="Charged" value={`+${data.charged}`} />
                    <MetricTile label="Drained" value={`−${data.drained}`} />
                  </Grid>
                  {data.confidence && !data.confidence.sufficient && (
                    <AppText variant="caption" tone="muted">
                      {BODY_BATTERY_SPARSE_DAY[0]}
                      {metricValue(data.confidence.sampleCount)}
                      {BODY_BATTERY_SPARSE_DAY[1]}
                      {metricValue(data.confidence.samplesPerHour, "", 1)}
                      {BODY_BATTERY_SPARSE_DAY[2]}
                    </AppText>
                  )}
                </>
              ) : (
                <AppText variant="caption" tone="muted">
                  The day’s curve will appear once heart-rate readings arrive.
                  No energy level is shown without recorded data.
                </AppText>
              )}
              <StressDayCard date={health.today} />
              <AppText variant="eyebrow" tone="muted">
                How it moves
              </AppText>
              <Grid columns={2}>
                <Card
                  tone="activity"
                  style={{
                    flex: 1,
                    gap: theme.spacing.xs,
                    padding: theme.spacing.md,
                  }}
                >
                  <AppText variant="label">Charges</AppText>
                  <AppText variant="caption">Rest and sleep</AppText>
                </Card>
                <Card
                  tone="heart"
                  style={{
                    flex: 1,
                    gap: theme.spacing.xs,
                    padding: theme.spacing.md,
                  }}
                >
                  <AppText variant="label">Drains</AppText>
                  <AppText variant="caption">
                    Training and elevated heart rate
                  </AppText>
                </Card>
              </Grid>
            </>
          ) : (
            <AppText variant="caption" tone="muted">
              Your recorded readings will appear here when available.
            </AppText>
          )}
        </Stack>
      )}
    </Card>
  );
}
