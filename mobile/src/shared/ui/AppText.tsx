import { createContext, useContext } from 'react';
import { Platform, StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { TextVariant } from '../theme/tokens';
import { MAX_TEXT_SCALE } from '../theme/text-scale';
import { resolveWeight, withGeist } from '../theme/fonts';

// The weight of the AppText a span sits in, so a nested one without its own weight keeps it.
const InheritedWeight = createContext<TextStyle['fontWeight']>(undefined);

export function AppText({
  variant = 'body',
  tone = 'text',
  mono = false,
  style,
  ...props
}: TextProps & {
  variant?: TextVariant;
  tone?: 'text' | 'muted' | 'brand' | 'danger';
  /** A monospace face, e.g. for a code to read out; withGeist keeps an explicit family. */
  mono?: boolean;
}) {
  const { theme, allowFontScaling } = useTheme();
  const inherited = useContext(InheritedWeight);
  const flat = StyleSheet.flatten([
    theme.typography[variant],
    { color: theme.colors[tone === 'brand' ? 'brandText' : tone] },
    mono ? { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) } : undefined,
    style,
  ]);
  return (
    <InheritedWeight.Provider value={resolveWeight(flat.fontWeight, inherited)}>
      <Text
        selectable={false}
        allowFontScaling={allowFontScaling}
        maxFontSizeMultiplier={MAX_TEXT_SCALE}
        accessibilityRole={variant === 'title' || variant === 'heading' ? 'header' : undefined}
        {...props}
        style={withGeist(flat, inherited)}
      />
    </InheritedWeight.Provider>
  );
}
