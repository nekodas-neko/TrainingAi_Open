import { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { AppButton, AppText, Icon, Sheet } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { mediaSpec } from '../data/models';

export function ExerciseMedia({ name, compact = false }: { name: string; compact?: boolean }) {
  const { theme } = useTheme();
  const media = useWorkoutResource(mediaSpec(name));
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setUri(null);
    setFailed(false);
    const source = media.data?.gifUrl ?? media.data?.imageUrl;
    if (source && media.resources) {
      void media.resources
        .media(source)
        .then((uri) => {
          if (current) {
            setUri(uri);
          }
        })
        .catch(() => {
          if (current) {
            setFailed(true);
          }
        });
    }
    return () => {
      current = false;
    };
  }, [name, media.data?.gifUrl, media.data?.imageUrl, media.resources, retry]);
  const size = compact ? theme.sizes.touchTarget : theme.sizes.demonstration;
  const picture = uri ? (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: theme.radii.control }}
      resizeMode="cover"
      accessibilityLabel={`${name} demonstration`}
      onError={() => setFailed(true)}
    />
  ) : (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radii.control,
        backgroundColor: theme.colors.raised,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="workout" tone="muted" />
    </View>
  );
  if (compact) {
    return picture;
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Show ${name} demonstration`}
        onPress={() => setExpanded(true)}
      >
        {picture}
      </Pressable>
      <Sheet visible={expanded} title={`${name} demonstration`} onClose={() => setExpanded(false)}>
        {uri && !failed ? (
          <Image
            source={{ uri }}
            style={{ width: '100%', height: theme.sizes.timerRing * 2 }}
            resizeMode="contain"
          />
        ) : (
          <>
            <AppText tone="muted">
              {failed || media.error
                ? 'Could not load the demonstration. Retry when connected.'
                : media.loading
                  ? 'Loading demonstration…'
                  : 'No demonstration is available for this exercise.'}
            </AppText>
            <AppButton
              title="Retry"
              onPress={() => {
                media.refresh();
                setRetry((value) => value + 1);
              }}
            />
          </>
        )}
      </Sheet>
    </>
  );
}
