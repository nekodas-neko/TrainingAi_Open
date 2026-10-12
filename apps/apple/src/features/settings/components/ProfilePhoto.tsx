import { useState } from 'react';
import { Image, Pressable } from 'react-native';
import { Avatar, Stack, StatusIndicator } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
export function ProfilePhoto({
  name,
  uri,
  onSaved,
}: {
  name: string;
  uri?: string | null;
  onSaved: () => void;
}) {
  const { theme } = useTheme(),
    resources = useWorkoutResources();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function change() {
    if (!resources || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (picked.canceled) {
        return;
      }
      const image = await manipulateAsync(
        picked.assets[0].uri,
        [{ resize: { width: 128, height: 128 } }],
        { compress: 0.85, format: SaveFormat.JPEG, base64: true },
      );
      if (!image.base64) {
        throw new Error('Missing photo');
      }
      await resources.write(
        'POST',
        '/api/user/avatar',
        { avatar: `data:image/jpeg;base64,${image.base64}` },
        ['/api/user/profile'],
      );
      onSaved();
    } catch {
      setError('Could not save your profile photo. Try again when connected.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack direction="row" align="center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change profile photo"
        disabled={busy || !resources}
        onPress={() => void change()}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={{
              width: theme.sizes.avatar * 1.5,
              height: theme.sizes.avatar * 1.5,
              borderRadius: theme.radii.pill,
            }}
          />
        ) : (
          <Avatar name={name} />
        )}
      </Pressable>
      <StatusIndicator label="Profile photo" busy={busy} error={error} />
    </Stack>
  );
}
