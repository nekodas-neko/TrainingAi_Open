import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Avatar, Icon, StatusIndicator } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { failureNotice } from '../../../core/reporting/index.ts';
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
    } catch (failure) {
      setError(
        failureNotice('Could not save your profile photo. Try again when connected.', failure),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ width: theme.sizes.profileAvatar, height: theme.sizes.profileAvatar }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change profile photo"
        accessibilityState={{ busy, disabled: busy || !resources }}
        disabled={busy || !resources}
        onPress={() => void change()}
      >
        <Avatar name={name} uri={uri} size={theme.sizes.profileAvatar} emphasized />
        {!busy && !error && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: theme.sizes.icon + theme.spacing.sm,
              height: theme.sizes.icon + theme.spacing.sm,
              borderRadius: theme.radii.pill,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.background,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="camera" size={theme.sizes.iconSmall} tone="muted" />
          </View>
        )}
      </Pressable>
      {(busy || error) && (
        <View
          style={{
            position: 'absolute',
            bottom: -theme.spacing.xs,
            right: -theme.spacing.xs,
            borderRadius: theme.radii.pill,
            backgroundColor: theme.colors.background,
          }}
        >
          <StatusIndicator
            label="Profile photo"
            busy={busy}
            error={error}
            onRetry={() => void change()}
          />
        </View>
      )}
    </View>
  );
}
