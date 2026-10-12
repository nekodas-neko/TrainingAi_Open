import { useState } from 'react';
import { Image, View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';

export function Avatar({
  name,
  uri,
  size,
}: {
  name: string;
  uri?: string | null;
  size?: number;
}) {
  const { theme } = useTheme();
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
        borderWidth: 1,
        borderColor: theme.colors.brandBorder,
        overflow: 'hidden',
      }}
    >
      <AppText variant="hero" tone="brand">
        {name.charAt(0).toUpperCase()}
      </AppText>
      {safe && (
        <Image
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
