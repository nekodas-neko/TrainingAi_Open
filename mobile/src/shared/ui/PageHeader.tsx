import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AppText } from './AppText';
import { IconButton } from './IconButton';
import { Stack } from './Stack';
import { BACK_LABEL, headerMetrics } from './headerMetrics';
import { useTheme } from '../theme/ThemeProvider';

type BackProps = {
  onBack?: () => void;
  backLabel?: string;
  backIcon?: 'back' | 'forward';
};

// The one Back control. Both header modes draw it, so its size and hit area never differ.
function BackControl({ onBack, backLabel = BACK_LABEL, backIcon = 'back' }: BackProps) {
  return <IconButton icon={backIcon} label={backLabel} onPress={onBack} />;
}

// A header item as tall as Back, centred on it: the bar's first row. A title block taller than
// this (subtitle, detail) grows the bar downward and never moves Back or the actions.
const rowSlot = { minHeight: headerMetrics.back.height, justifyContent: 'center' as const };

/**
 * A subtitle that does not fit wraps at its " · " separators, never inside a part and never with a
 * dot left to start a line: each part's spaces are held together and the dot stays with the part
 * before it. The characters look the same as before, so a subtitle that fits is unchanged (#4058).
 */
export function breakAtSeparators(text: string): string {
  const parts = text.split(' · ');
  if (parts.length < 2) return text;
  return parts.map((part) => part.replace(/ /g, '\u00A0')).join('\u00A0· ');
}

export type PageHeaderProps =
  | ({
      mode?: 'bar';
      title: string;
      subtitle?: ReactNode;
      detail?: string;
      actions?: ReactNode;
      /** Drawn between the title and the actions. */
      titleAction?: ReactNode;
      /** Drawn after the actions (the workout timer). */
      trailing?: ReactNode;
      /** A tab's header: roomier, and no rule under it. */
      landing?: boolean;
    } & BackProps)
  | ({
      mode: 'hero';
      title: string;
      actions?: ReactNode;
    } & Required<Pick<BackProps, 'onBack'>>);

/**
 * The page header, in two modes. 'bar' is the plain bar every screen but a health detail uses: it
 * stays put while the page scrolls. 'hero' is drawn over a health detail's picture and scrolls
 * with it; only its Back control moves, to exactly where the bar's Back sits.
 */
export function PageHeader(props: PageHeaderProps) {
  const { theme } = useTheme();
  const m = headerMetrics;
  if (props.mode === 'hero') {
    return (
      <Stack
        direction="row"
        align="center"
        style={{
          position: 'absolute',
          top: m.back.top,
          left: m.back.left,
          right: m.sidePadding,
        }}
      >
        <View
          style={{
            backgroundColor:
              theme.mode === 'light'
                ? theme.healthArtColors.lightChip
                : theme.healthArtColors.darkChip,
            borderRadius: theme.radii.pill,
          }}
        >
          <BackControl onBack={props.onBack} />
        </View>
        <AppText variant="label" style={{ flex: 1 }}>
          {props.title}
        </AppText>
        {props.actions}
      </Stack>
    );
  }
  const { title, subtitle, detail, actions, titleAction, trailing, landing = false } = props;
  return (
    <Stack
      direction="row"
      align="flex-start"
      gap="sm"
      style={{
        paddingHorizontal: m.sidePadding,
        paddingVertical: landing ? m.landingPaddingVertical : m.barPaddingVertical,
        borderBottomWidth: landing ? 0 : 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      {props.onBack && (
        <View style={{ alignSelf: 'flex-start' }}>
          <BackControl {...props} />
        </View>
      )}
      <View style={[{ flex: 1, minWidth: 0 }, rowSlot]}>
        <AppText variant={m.titleVariant} numberOfLines={1} accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? (
          typeof subtitle === 'string' ? (
            <AppText variant="body" tone="muted">
              {breakAtSeparators(subtitle)}
            </AppText>
          ) : (
            subtitle
          )
        ) : null}
        {detail && (
          <AppText variant="caption" tone="muted">
            {detail}
          </AppText>
        )}
      </View>
      {titleAction && <View style={rowSlot}>{titleAction}</View>}
      {actions && (
        <View style={rowSlot}>
          <Stack direction="row" gap="xs">
            {actions}
          </Stack>
        </View>
      )}
      {trailing && <View style={rowSlot}>{trailing}</View>}
    </Stack>
  );
}
