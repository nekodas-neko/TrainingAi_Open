import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { ACTIVITY_LEVELS, FITNESS_GOALS } from '@trainingai/shared/types/user';
import {
  AppText,
  Card,
  KeyValueGrid,
  PageLayout,
  Picker,
  Skeleton,
  Stack,
  StatusIndicator,
  TextField,
} from '../../../shared/ui';
import { useAccountContext } from '../../account/AccountProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { profileSpec, metricValue, bodyOverviewSpec } from '../../health/data/models';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { ProfileOverview } from '../components/ProfileOverview';
import { profilePatch, timezoneOptions } from '../data/profile';
const schema = z.object({
  fields: z.record(z.string(), z.string()),
  dirty: z.array(z.string()),
});
export function ProfileDetailsScreen({
  onBack,
  openClinical,
  openBaselines,
}: {
  onBack: () => void;
  openClinical: () => void;
  openBaselines: () => void;
}) {
  const state = useWorkoutResource(profileSpec);
  return (
    <PageLayout
      title="Profile details"
      onBack={onBack}
      scroll
      actions={
        <StatusIndicator
          label="Profile"
          busy={state.refreshing}
          error={state.error}
          onRetry={state.refresh}
        />
      }
    >
      {!state.connected ? (
        <AppText>Sign in from Account & settings to view and edit your profile.</AppText>
      ) : state.data ? (
        <ProfileDetailsForm
          key={`${state.resources?.connection.origin}:${state.resources?.connection.userId}`}
          user={state.data.user}
          openClinical={openClinical}
          openBaselines={openBaselines}
        />
      ) : (
        <Skeleton style={{ flex: 1 }} />
      )}
    </PageLayout>
  );
}
function ProfileDetailsForm({
  user,
  openClinical,
  openBaselines,
}: {
  user: z.infer<typeof profileSpec.schema>['user'];
  openClinical: () => void;
  openBaselines: () => void;
}) {
  const nutrition = useNutrition();
  const health = useHealthData(),
    account = useAccountContext();
  const draft = useWorkoutDraft('profile-details', schema, {
    fields: Object.fromEntries(
      [
        'displayName',
        'heightCm',
        'dateOfBirth',
        'sex',
        'activityLevel',
        'fitnessGoal',
        'timezone',
      ].map((key) => [key, user[key] == null ? '' : String(user[key])]),
    ),
    dirty: [],
  });
  const [saving, setSaving] = useState(0),
    [error, setError] = useState<string | null>(null),
    [saved, setSaved] = useState(false);
  const current = useRef(draft.value);
  current.current = draft.value;
  const setDraft = draft.setValue;
  const ready = draft.ready;
  useEffect(() => {
    if (!ready) return;
    setDraft((value) => {
      const fields = { ...value.fields };
      for (const key of Object.keys(fields))
        if (!value.dirty.includes(key))
          fields[key] = user[key] == null ? '' : String(user[key]);
      return JSON.stringify(fields) === JSON.stringify(value.fields)
        ? value
        : { ...value, fields };
    });
  }, [ready, setDraft, user]);
  function change(key: string, value: string, immediate = false) {
    const next = {
      ...current.current,
      fields: { ...current.current.fields, [key]: value },
      dirty: [...new Set([...current.current.dirty, key])],
    };
    current.current = next;
    draft.setValue(next);
    setSaved(false);
    if (immediate) void save([key], next.fields);
  }
  async function save(keys = current.current.dirty, fields = current.current.fields) {
    if (!draft.ready || !draft.resources || !keys.length) return;
    let body;
    try {
      body = profilePatch(fields, keys);
    } catch {
      setError(
        'Check the edited fields. Height must be 50–300 cm, and dates and timezones must be valid.',
      );
      return;
    }
    setSaving((x) => x + 1);
    setError(null);
    try {
      await draft.resources.write('PATCH', '/api/user/profile', body, [
        '/api/user/profile',
        '/api/nutrition',
        '/api/hr-profile',
        '/api/readiness',
        '/api/body-battery',
      ]);
      const next = {
        ...current.current,
        dirty: current.current.dirty.filter(
          (key) => !keys.includes(key) || current.current.fields[key] !== fields[key],
        ),
      };
      current.current = next;
      draft.setValue(next);
      setSaved(!next.dirty.length);
      if ('timezone' in body) await account.retry();
    } catch {
      setError(
        'Could not save your profile. Your edits are saved on this phone; retry when connected.',
      );
    } finally {
      setSaving((x) => Math.max(0, x - 1));
    }
  }
  const overview = useWorkoutResource(bodyOverviewSpec(health.today));
  const byDate = new Map((overview.data?.measuredOverview ?? []).map((x) => [x.date, x]));
  for (const row of health.body?.recent ?? []) byDate.set(row.date, row);
  const rows = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  const fat = rows.find((x) => x.bodyFatCorrected != null || x.bodyFat != null);
  const weight =
    health.body?.latestWeightKg ??
    overview.data?.latestWeightKg ??
    rows.find((x) => x.weightKg != null)?.weightKg;
  const weightDate =
    health.body?.latestWeightDate ??
    overview.data?.latestWeightDate ??
    rows.find((x) => x.weightKg != null)?.date;
  const f = draft.value.fields;
  return (
    <Stack gap="lg">
      <Card>
        <AppText variant="heading">Your details</AppText>
        <AppText variant="caption" tone="muted">
          Text fields save when you finish editing. Choices save immediately.
        </AppText>
        <StatusIndicator
          label="Profile details"
          busy={saving > 0}
          error={error ?? draft.error}
          message={
            saved ? 'Saved' : draft.value.dirty.length ? 'Edits saved on this phone' : null
          }
          onRetry={() => void save()}
        />
        {[
          ['displayName', 'Display name'],
          ['heightCm', 'Height (cm)'],
          ['dateOfBirth', 'Date of birth (YYYY-MM-DD)'],
        ].map(([key, label]) => (
          <TextField
            key={key}
            label={label}
            editable={draft.ready}
            value={f[key]}
            keyboardType={key === 'heightCm' ? 'decimal-pad' : 'default'}
            maxLength={key === 'displayName' ? 100 : undefined}
            onChangeText={(value) => change(key, value)}
            onBlur={() => void save([key])}
          />
        ))}
        <KeyValueGrid
          rows={[
            {
              label: 'Weight',
              value: `${metricValue(weight, 'kg', 1)}${weightDate ? ` · ${weightDate}` : ''}`,
            },
            {
              label: 'Body fat',
              value: `${metricValue(fat?.bodyFatCorrected ?? fat?.bodyFat, '%', 1)}${fat ? ` · ${fat.date}` : ''}`,
            },
          ]}
        />
        <Picker
          label="Sex"
          value={f.sex}
          options={[
            { value: '', label: 'Not set' },
            ...['male', 'female', 'other'].map((value) => ({ value, label: value })),
          ]}
          onChange={(value) => change('sex', value, true)}
        />
        <Picker
          label="Activity level"
          value={f.activityLevel}
          options={[
            { value: '', label: 'Not set' },
            ...ACTIVITY_LEVELS.map((value) => ({ value, label: value.replaceAll('_', ' ') })),
          ]}
          onChange={(value) => change('activityLevel', value, true)}
        />
        <Picker
          label="Fitness goal"
          value={f.fitnessGoal}
          options={[
            { value: '', label: 'Not set' },
            ...FITNESS_GOALS.map((value) => ({ value, label: value.replaceAll('_', ' ') })),
          ]}
          onChange={(value) => change('fitnessGoal', value, true)}
        />
        <Picker
          label="Timezone"
          searchable
          value={f.timezone || health.timezone}
          options={timezoneOptions(f.timezone || health.timezone)}
          onChange={(value) => change('timezone', value, true)}
        />
        <Picker
          label="Food search region"
          value={nutrition.region}
          options={[
            { value: 'AU', label: 'Australia' },
            { value: 'NZ', label: 'New Zealand' },
            { value: 'US', label: 'United States' },
            { value: 'GB', label: 'United Kingdom' },
            { value: 'CA', label: 'Canada' },
          ]}
          onChange={nutrition.setRegion}
        />
      </Card>
      <ProfileOverview openClinical={openClinical} openBaselines={openBaselines} />
    </Stack>
  );
}
