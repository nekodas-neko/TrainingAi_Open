import { useState } from 'react';
import { z } from 'zod';
import {
  AppButton,
  AppText,
  Picker,
  Sheet,
  StatusIndicator,
  TextField,
} from '../../../shared/ui';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
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
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
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
        screenshotData: null,
      });
      await resources.clearDraft('feedback');
      onClose();
    } catch {
      setError('Could not send feedback. Your draft is saved; retry when connected.');
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
      <Picker
        label="Type"
        value={draft.value.type}
        options={[
          { value: 'bug', label: 'Bug report' },
          { value: 'feature', label: 'Feature request' },
          { value: 'other', label: 'Question or other feedback' },
        ]}
        onChange={(type) => draft.setValue({ ...draft.value, type })}
      />
      <TextField
        label="Title"
        value={draft.value.title}
        onChangeText={(title) => draft.setValue({ ...draft.value, title })}
      />
      <TextField
        label="Description"
        multiline
        value={draft.value.description}
        onChangeText={(description) => draft.setValue({ ...draft.value, description })}
      />
    </Sheet>
  );
}
