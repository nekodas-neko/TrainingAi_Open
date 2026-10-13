import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Skeleton } from './Skeleton';
export function Thumbnail({
  uri,
  label,
  icon = 'nutrition',
}: {
  uri?: string | null;
  label: string;
  icon?: IconName;
}) {
  const { theme } = useTheme();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [uri]);
  const size = theme.sizes.foodThumbnail;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radii.small,
        overflow: 'hidden',
        backgroundColor: theme.colors.raised,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {uri && !failed ? (
        <>
          <Image
            source={{ uri }}
            accessibilityLabel={label}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            resizeMode="cover"
            style={{ position: 'absolute', width: size, height: size }}
          />
          {!loaded && <Skeleton style={{ width: size, height: size }} />}
        </>
      ) : (
        <Icon name={icon} tone="muted" size={theme.sizes.iconSmall} />
      )}
    </View>
  );
}
