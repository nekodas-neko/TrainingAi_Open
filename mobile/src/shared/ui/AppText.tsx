import { Text, type TextProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { TextVariant } from '../theme/tokens';
import { MAX_TEXT_SCALE } from '../theme/text-scale';

export function AppText({
  variant = 'body',
  tone = 'text',
  style,
  ...props
}: TextProps & { variant?: TextVariant; tone?: 'text' | 'muted' | 'brand' | 'danger' }) {
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
        style,
      ]}
    />
  );
}
