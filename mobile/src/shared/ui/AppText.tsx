import { Platform, Text, type TextProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { TextVariant } from '../theme/tokens';
import { MAX_TEXT_SCALE } from '../theme/text-scale';

export function AppText({
  variant = 'body',
  tone = 'text',
  mono = false,
  style,
  ...props
}: TextProps & {
  variant?: TextVariant;
  tone?: 'text' | 'muted' | 'brand' | 'danger';
  /** Monospace, for codes the user reads out or retypes (the web's font-mono). */
  mono?: boolean;
}) {
  const { theme, allowFontScaling } = useTheme();
  return (
    <Text
      selectable={false}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={MAX_TEXT_SCALE}
      accessibilityRole={variant === 'title' || variant === 'heading' ? 'header' : undefined}
      {...props}
      style={[
        theme.typography[variant],
        { color: theme.colors[tone === 'brand' ? 'brandText' : tone] },
        mono ? { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) } : undefined,
        style,
      ]}
    />
  );
}
