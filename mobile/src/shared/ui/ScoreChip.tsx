import { useId, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, {
  Circle,
  Path,
  Defs,
  RadialGradient,
  Stop,
  Rect,
} from "react-native-svg";
import { AppText } from "./AppText";
import { Icon, type IconName } from "./Icon";
import { Stack } from "./Stack";
import { useTheme } from "../theme/ThemeProvider";
import { isBandStyle, scoreChipLabel } from "./scoreChipStyle";
import type { Tone } from "../theme/theme";

export function ScoreChip({
  label,
  shortLabel,
  value,
  icon,
  tone,
  onPress,
  qualified = false,
  style = "default",
  color: accent,
  display,
  first = false,
}: {
  label: string;
  /** The band styles' small-capital name for the score ("Move" for Activity). */
  shortLabel?: string;
  value: number | null;
  icon: IconName;
  tone: Tone;
  onPress: () => void;
  qualified?: boolean;
  style?: string;
  color?: string;
  display?: string;
  first?: boolean;
}) {
  const { theme } = useTheme();
  const [compact, setCompact] = useState(false);
  const id = useId().replace(/:/g, "");
  const color = accent ?? theme.tones[tone].foreground;
  const text = display ?? (value === null ? "—" : String(Math.round(value)));
  const circle = [
    "default",
    "openring",
    "perforated",
    "accentring",
    "halo",
    "bare",
    "watermark",
    "overlap",
  ].includes(style);
  const tile = style === "squircle" || style === "frosted";
  const pill = style === "pill";
  const rail = style === "rail" || style === "duorail";
  const band = isBandStyle(style);
  const minimal = ["footnote", "nolabel", "accentrule", "divider"].includes(
    style,
  );
  const framed = ["default", "openring", "perforated", "accentring"].includes(
    style,
  );
  const shown = scoreChipLabel(style, label, shortLabel);
  const labelView = (
    <Stack direction="row" align="center" gap="xxs">
      <AppText
        variant={shown.capitals ? "figureLabel" : "micro"}
        tone="muted"
        numberOfLines={1}
      >
        {shown.text}
      </AppText>
      {qualified && <Icon name="info" size={theme.spacing.md} tone="muted" />}
    </Stack>
  );
  const glyph = (
    <Icon
      name={icon}
      size={
        pill || rail || minimal || band || compact
          ? theme.sizes.iconSmall
          : theme.sizes.icon
      }
      color={color}
    />
  );
  const number = (
    <AppText
      variant={pill || rail ? "heading" : compact ? "hero" : "score"}
      numberOfLines={1}
      adjustsFontSizeToFit
    >
      {text}
    </AppText>
  );
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      accessibilityLabel={`${label}: ${display ?? value ?? "unavailable"}${qualified ? ", limited or provisional data" : ""}`}
      style={{
        flex: 1,
        minWidth: 0,
        alignItems: "center",
        justifyContent: "center",
        gap: theme.spacing.xs,
        minHeight: theme.sizes.touchTarget,
        paddingVertical: rail || band || minimal ? theme.spacing.sm : 0,
        borderLeftWidth: (rail || style === "divider") && !first ? 1 : 0,
        borderColor: theme.colors.border,
        borderTopWidth: style === "band" ? 1 : 0,
        borderBottomWidth: band ? 1 : 0,
      }}
    >
      {circle || tile ? (
        <>
          <View
            onLayout={(event) =>
              setCompact(
                event.nativeEvent.layout.width <
                  theme.sizes.touchTarget + theme.sizes.icon + theme.spacing.sm,
              )
            }
            style={{
              width: "100%",
              aspectRatio: 1,
              maxWidth: theme.sizes.scoreChip,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: tile ? theme.radii.card : theme.radii.pill,
              borderWidth: tile ? 1 : 0,
              borderColor: theme.colors.border,
              backgroundColor: tile
                ? `${color}${style === "frosted" ? "14" : "28"}`
                : undefined,
            }}
          >
            {framed && (
              <Svg
                width="100%"
                height="100%"
                viewBox="0 0 100 100"
                style={{ position: "absolute" }}
              >
                {style === "openring" ? (
                  <Path
                    d="M 15 26 A 42.5 42.5 0 1 1 15 74"
                    fill="none"
                    stroke={theme.colors.muted}
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                ) : style === "perforated" ? (
                  Array.from({ length: 24 }, (_, i) => {
                    const angle = (i * Math.PI) / 12;
                    return (
                      <Circle
                        key={i}
                        cx={50 + 42.5 * Math.cos(angle)}
                        cy={50 + 42.5 * Math.sin(angle)}
                        r="1.7"
                        fill={theme.colors.muted}
                      />
                    );
                  })
                ) : (
                  <Circle
                    cx="50"
                    cy="50"
                    r="42.5"
                    fill="none"
                    stroke={style === "accentring" ? color : theme.colors.muted}
                    strokeWidth="2"
                    strokeDasharray={
                      style === "accentring" ? "200 67" : undefined
                    }
                  />
                )}
              </Svg>
            )}
            {style === "halo" && (
              <Svg width="100%" height="100%" style={{ position: "absolute" }}>
                <Defs>
                  <RadialGradient id={id}>
                    <Stop offset="0" stopColor={color} stopOpacity=".28" />
                    <Stop offset="1" stopColor={color} stopOpacity="0" />
                  </RadialGradient>
                </Defs>
                <Rect width="100%" height="100%" fill={`url(#${id})`} />
              </Svg>
            )}
            {style === "watermark" && (
              <Icon
                name={icon}
                size={theme.sizes.scoreChip * 0.65}
                color={color}
                style={{ position: "absolute", opacity: 0.16 }}
              />
            )}
            {style === "overlap" ? (
              <>
                {number}
                <Icon
                  name={icon}
                  color={color}
                  style={{ position: "absolute", top: "18%", left: "20%" }}
                />
              </>
            ) : (
              <Stack align="center" gap="xxs">
                {style !== "watermark" && glyph}
                {number}
              </Stack>
            )}
          </View>
          {labelView}
        </>
      ) : pill ? (
        <Stack
          direction="row"
          align="center"
          style={{
            width: "100%",
            minHeight: theme.sizes.button,
            justifyContent: "center",
            borderRadius: theme.radii.card,
            borderWidth: 1,
            borderColor: `${color}55`,
            backgroundColor: `${color}1a`,
          }}
        >
          {glyph}
          {number}
          {qualified && (
            <Icon name="info" size={theme.spacing.md} tone="muted" />
          )}
        </Stack>
      ) : (
        <>
          {style === "duorail" && (
            <Icon
              name={icon}
              size={theme.sizes.workoutButton}
              color={color}
              style={{ position: "absolute", opacity: 0.18 }}
            />
          )}
          {style === "footnote" ? (
            <>
              {number}
              <Stack direction="row" align="center" gap="xxs">
                {glyph}
                {labelView}
              </Stack>
            </>
          ) : (
            <>
              {glyph}
              {number}
              {style !== "nolabel" && labelView}
            </>
          )}
          {style === "accentrule" && (
            <View
              style={{
                height: theme.spacing.xxs,
                width: "100%",
                backgroundColor: color,
              }}
            />
          )}
        </>
      )}
    </Pressable>
  );
}
