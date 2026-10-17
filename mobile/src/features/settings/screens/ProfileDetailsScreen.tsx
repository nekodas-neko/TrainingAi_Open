import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { latestDisplayedBodyFat } from '@trainingai/shared/health/body-fat-display';
import { formatDateDisplay } from '@trainingai/shared/date-utils';
import {
  AppButton,
  AppText,
  Card,
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
import { birthYearOf, profilePatch, timezoneOptions } from '../data/profile';
// Name, birth year, height, sex and timezone are what the current app's Edit profile sheet and
// Profile details hold. Activity level and Fitness goal are on the Goals screen there, and here.
const FIELD_KEYS = ['displayName', 'heightCm', 'birthYear', 'sex', 'timezone'];
function fieldValue(user: Record<string, unknown>, key: string) {
  if (key === 'birthYear') return birthYearOf(user.dateOfBirth);
  return user[key] == null ? '' : String(user[key]);
}
const schema = z.object({
  fields: z.record(z.string(), z.string()),
  dirty: z.array(z.string()),
});
export function ProfileDetailsScreen({
  onBack,
  openClinical,
  openBaselines,
  openHealthBody,
}: {
  onBack: () => void;
  openClinical: () => void;
  openBaselines: () => void;
  openHealthBody: () => void;
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
          openHealthBody={openHealthBody}
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
  openHealthBody,
}: {
  user: z.infer<typeof profileSpec.schema>['user'];
  openClinical: () => void;
  openBaselines: () => void;
  openHealthBody: () => void;
}) {
  const nutrition = useNutrition();
  const health = useHealthData(),
    account = useAccountContext();
  const draft = useWorkoutDraft('profile-details', schema, {
    fields: Object.fromEntries(
      FIELD_KEYS.map((key) => [key, fieldValue(user, key)]),
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
          fields[key] = fieldValue(user, key);
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
      body = profilePatch(fields, keys, user.dateOfBirth);
    } catch {
      setError(
        'Check the edited fields. Height must be 50–300 cm, birth year four digits, and the timezone valid.',
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
  const { value: fat } = latestDisplayedBodyFat(rows);
  const fatDate = rows.find((x) => latestDisplayedBodyFat([x]).value != null)?.date;
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
        <TextField
          label="Display name"
          editable={draft.ready}
          value={f.displayName}
          maxLength={100}
          onChangeText={(value) => change('displayName', value)}
          onBlur={() => void save(['displayName'])}
        />
        <Picker
          label="Biological sex"
          value={f.sex}
          options={[
            { value: '', label: 'Not set' },
            ...[
              ['male', 'Male'],
              ['female', 'Female'],
              ['other', 'Other'],
            ].map(([value, label]) => ({ value, label })),
          ]}
          onChange={(value) => change('sex', value, true)}
        />
        <AppText variant="caption" tone="muted">
          Used for BMI and energy balance estimates
        </AppText>
        <TextField
          label="Birth year"
          editable={draft.ready}
          value={f.birthYear}
          placeholder="1990"
          keyboardType="number-pad"
          maxLength={4}
          onChangeText={(value) => change('birthYear', value)}
          onBlur={() => void save(['birthYear'])}
        />
        <TextField
          label="Height (cm)"
          editable={draft.ready}
          value={f.heightCm}
          placeholder="175"
          keyboardType="decimal-pad"
          onChangeText={(value) => change('heightCm', value)}
          onBlur={() => void save(['heightCm'])}
        />
        <MeasurementRow
          label="Weight"
          value={weight == null ? null : metricValue(weight, 'kg', 1)}
          when={weightDate ? dayLabel(weightDate, health.today) : null}
          emptyLabel="No weigh-ins yet"
          action="Log a weigh-in"
          onAction={openHealthBody}
        />
        <MeasurementRow
          label="Body fat %"
          value={fat == null ? null : metricValue(fat, '%', 1)}
          when={fatDate ? dayLabel(fatDate, health.today) : null}
          emptyLabel="Not logged"
          action="Log body fat %"
          onAction={openHealthBody}
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

function dayLabel(date: string, today: string) {
  return date === today ? 'Today' : formatDateDisplay(date);
}
/** A measured value with the day it was taken, and the way to log another: never an input. */
function MeasurementRow({
  label,
  value,
  when,
  emptyLabel,
  action,
  onAction,
}: {
  label: string;
  value: string | null;
  when: string | null;
  emptyLabel: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <Stack gap="xs">
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <Stack direction="row" align="center" justify="space-between">
        <AppText tone={value == null ? 'muted' : undefined} style={{ flex: 1 }}>
          {value == null ? emptyLabel : `${value}${when ? ` · ${when}` : ''}`}
        </AppText>
        <AppButton title={action} variant="surface" onPress={onAction} />
      </Stack>
    </Stack>
  );
}
