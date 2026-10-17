import { useState } from 'react';
import { Image } from 'react-native';
import { z } from 'zod';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import {
  AppButton,
  AppText,
  SegmentedControl,
  Sheet,
  Stack,
  StatusIndicator,
  TextField,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { imageResize } from '../../../integrations/nutrition/image-size';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
// The web sheet's limits: longest edge 800 px, JPEG at 0.7. The server refuses a screenshot over
// 500,000 characters, which this stays well under.
const SCREENSHOT_MAX_EDGE = 800;
const SCREENSHOT_MAX_CHARS = 500_000;
const schema = z.object({
  type: z.enum(['bug', 'feature', 'other']),
  title: z.string(),
  description: z.string(),
});
export function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const resources = useWorkoutResources();
  const draft = useWorkoutDraft('feedback', schema, {
    type: 'bug',
    title: '',
    description: '',
  });
  const { theme } = useTheme();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [screenshot, setScreenshot] = useState<string | null>(null),
    [screenshotError, setScreenshotError] = useState<string | null>(null),
    [picking, setPicking] = useState(false);
  async function attach() {
    if (picking) return;
    setPicking(true);
    setScreenshotError(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const image = await manipulateAsync(
        asset.uri,
        imageResize(asset.width, asset.height, SCREENSHOT_MAX_EDGE).map((x) => ({
          resize: x.resize,
        })),
        { compress: 0.7, format: SaveFormat.JPEG, base64: true },
      );
      const data = image.base64 ? `data:image/jpeg;base64,${image.base64}` : null;
      if (!data || data.length > SCREENSHOT_MAX_CHARS) throw new Error('Unusable image');
      setScreenshot(data);
    } catch {
      setScreenshotError('Could not use that image. Try a different one.');
    } finally {
      setPicking(false);
    }
  }
  async function save() {
    if (!resources || busy || !draft.value.title.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resources.write('POST', '/api/feedback', {
        ...draft.value,
        title: draft.value.title.trim(),
        description: draft.value.description.trim() || null,
        screenshotData: screenshot,
      });
      await resources.clearDraft('feedback');
      setScreenshot(null);
      onClose();
    } catch {
      setError('Could not send feedback. Your text is saved; re-attach the screenshot and retry when connected.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      visible
      fullHeight
      title="Feedback"
      onClose={onClose}
      actions={<StatusIndicator label="Feedback" busy={busy} error={error ?? draft.error} />}
      footer={
        <AppButton
          title="Send feedback"
          busy={busy}
          disabled={!resources || !draft.ready || !draft.value.title.trim()}
          onPress={() => void save()}
        />
      }
    >
      <AppText variant="caption" tone="muted">
        Report a problem, suggest a feature or ask a question.
      </AppText>
      <AppText variant="caption" tone="muted">
        Type
      </AppText>
      <SegmentedControl
        label="Feedback type"
        value={draft.value.type}
        options={[
          { value: 'bug', label: 'Bug' },
          { value: 'feature', label: 'Feature Request' },
          { value: 'other', label: 'Other' },
        ]}
        onChange={(type) => draft.setValue({ ...draft.value, type })}
      />
      <TextField
        label="Title (required)"
        placeholder="Brief description"
        value={draft.value.title}
        onChangeText={(title) => draft.setValue({ ...draft.value, title })}
      />
      <TextField
        label="Details (optional)"
        placeholder="Steps to reproduce, expected vs actual behaviour, ideas…"
        multiline
        value={draft.value.description}
        onChangeText={(description) => draft.setValue({ ...draft.value, description })}
      />
      <Stack gap="xs">
        <AppText variant="caption" tone="muted">
          Screenshot (optional)
        </AppText>
        {screenshot ? (
          <Stack gap="sm" align="flex-start">
            <Image
              accessibilityLabel="Attached screenshot"
              source={{ uri: screenshot }}
              resizeMode="contain"
              style={{
                width: '100%',
                height: 160,
                borderRadius: theme.radii.control,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            />
            <AppButton
              title="Remove screenshot"
              icon="close"
              variant="surface"
              onPress={() => setScreenshot(null)}
            />
          </Stack>
        ) : (
          <AppButton
            title="Attach screenshot"
            icon="camera"
            variant="surface"
            busy={picking}
            onPress={() => void attach()}
          />
        )}
        {screenshotError && (
          <AppText variant="caption" tone="danger">
            {screenshotError}
          </AppText>
        )}
      </Stack>
    </Sheet>
  );
}
