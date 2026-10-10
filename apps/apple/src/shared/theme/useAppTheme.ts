import { Platform, PlatformColor, StyleSheet, useColorScheme } from 'react-native';

export function useAppTheme() {
  const dark = useColorScheme() === 'dark' && Platform.OS !== 'web';
  const colors = {
    background:
      Platform.OS === 'ios' ? PlatformColor('systemBackground') : dark ? '#000000' : '#ffffff',
    text: Platform.OS === 'ios' ? PlatformColor('label') : dark ? '#ffffff' : '#000000',
    secondary:
      Platform.OS === 'ios' ? PlatformColor('secondaryLabel') : dark ? '#aaaaaa' : '#666666',
    separator: Platform.OS === 'ios' ? PlatformColor('separator') : dark ? '#38383a' : '#d1d1d6',
    blue: Platform.OS === 'ios' ? PlatformColor('systemBlue') : '#007aff',
    red: Platform.OS === 'ios' ? PlatformColor('systemRed') : '#c62828',
  };
  const s = makeStyles(colors);
  return { dark, colors, styles: s };
}

type Color = ReturnType<typeof PlatformColor> | string;
const makeStyles = (colors: {
  background: Color;
  text: Color;
  secondary: Color;
  separator: Color;
  blue: Color;
  red: Color;
}) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    content: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 32,
      maxWidth: 680,
      width: '100%',
      alignSelf: 'center',
    },
    brand: { color: colors.secondary, fontSize: 15, marginBottom: 8 },
    title: { color: colors.text, fontSize: 34, fontWeight: '700', marginBottom: 24 },
    muted: { color: colors.secondary, fontSize: 15, lineHeight: 22 },
    small: { color: colors.secondary, fontSize: 13, lineHeight: 20 },
    notice: {
      paddingBottom: 20,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      gap: 4,
    },
    noticeText: { color: colors.text, fontSize: 17, fontWeight: '600' },
    card: {
      paddingVertical: 18,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      gap: 6,
    },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 10,
    },
    label: { color: colors.text, fontSize: 17, flexShrink: 1 },
    value: { color: colors.text, fontSize: 17, fontWeight: '600' },
    heading: { color: colors.text, fontSize: 17, fontWeight: '600' },
    actions: { marginTop: 24, gap: 12 },
    error: { paddingVertical: 16 },
    errorText: { color: colors.red, fontSize: 15, lineHeight: 22 },
    tabs: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      backgroundColor: colors.background,
    },
    tab: { flex: 1, paddingVertical: 18, alignItems: 'center' },
    tabText: { color: colors.secondary, fontSize: 15 },
  });

export type AppStyles = ReturnType<typeof makeStyles>;
