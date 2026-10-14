import { useState } from 'react';
import { Image, View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';

export function Avatar({
  name,
  uri,
  size,
  emphasized = false,
}: {
  name: string;
  uri?: string | null;
  size?: number;
  emphasized?: boolean;
}) {
  const { theme } = useTheme();
  const initials =
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?';
  const [failed, setFailed] = useState<string | null>(null);
  const safe =
    !!uri &&
    uri !== failed &&
    (uri.startsWith('https://') ||
      (/^data:image\/(png|jpeg|webp);base64,/.test(uri) && uri.length < 1048576));
  return (
    <View
      accessible={false}
      style={{
        width: size ?? theme.sizes.avatar,
        height: size ?? theme.sizes.avatar,
        borderRadius: theme.radii.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.brandSurface,
        borderWidth: emphasized ? 2 : 1,
        borderColor: emphasized ? theme.colors.brand : theme.colors.brandBorder,
        boxShadow: emphasized
          ? `0 0 ${theme.spacing.xl}px ${theme.colors.brandBorder}`
          : undefined,
        overflow: 'hidden',
      }}
    >
      <AppText
        variant="hero"
        tone="brand"
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{ textAlign: 'center' }}
      >
        {initials}
      </AppText>
      {safe && (
        <Image
          alt=""
          source={{ uri: uri!, cache: 'force-cache' }}
          onError={() => setFailed(uri!)}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
          accessible={false}
        />
      )}
    </View>
  );
}
