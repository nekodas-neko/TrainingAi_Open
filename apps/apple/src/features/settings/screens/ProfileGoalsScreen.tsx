import { ACTIVITY_LEVELS, FITNESS_GOALS } from '@trainingai/shared/types/user';
import { goalBoundSchema } from '@trainingai/shared/validation/goal-bounds';
import { useState } from 'react';
import { z } from 'zod';
import {
  AppButton,
  AppText,
  Card,
  Disclosure,
  IconButton,
  ListRow,
  PageLayout,
  Picker,
  Sheet,
  Skeleton,
  Stack,
  StatusIndicator,
  SwitchRow,
  TabPanel,
  TextField,
} from '../../../shared/ui';
import { energySpec } from '../../health/data/models';
import { GoalRecommendation } from '../../nutrition/components/GoalRecommendation';
import { NutritionTargets } from '../../nutrition/components/NutritionSettings';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import {
  useWorkoutResource,
  useWorkoutResources,
} from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { ProfileOverview } from '../components/ProfileOverview';
const profile = z
  .object({
    displayName: z.string().nullish(),
    heightCm: z.number().nullish(),
    dateOfBirth: z.string().nullish(),
    sex: z.string().nullish(),
    activityLevel: z.string().nullish(),
    fitnessGoal: z.string().nullish(),
  })
  .passthrough();
const goals = z
  .object({
    stepsGoal: z.number().nullish(),
    stepsGoalType: z.string().nullish(),
    sleepGoalHours: z.number().nullish(),
    waterGoalMl: z.number().nullish(),
    waterGoalType: z.string().nullish(),
    targetWeightKg: z.number().nullish(),
    targetBfPct: z.number().nullish(),
    calorieGoal: z.number().nullish(),
    calorieGoalType: z.string().nullish(),
  })
  .passthrough();
const formSchema = z.object({
  profile: z.record(z.string(), z.string()),
  goals: z.record(z.string(), z.string()),
  own: z.boolean(),
});
const goalsBody = z.object({
  stepsGoal: goalBoundSchema('stepsGoal').nullable(),
  stepsGoalType: z.enum(['daily', 'weekly']),
  sleepGoalHours: z.number().min(0).max(24).nullable(),
  waterGoalMl: goalBoundSchema('waterGoalMl').nullable(),
  waterGoalType: z.enum(['daily', 'weekly']),
  targetWeightKg: z.number().min(20).max(500).nullable(),
  targetBfPct: z.number().min(0).max(70).nullable(),
  calorieGoal: goalBoundSchema('calorieGoal').nullable(),
  calorieGoalType: z.enum(['daily', 'own']),
});
export function ProfileGoalsScreen({ onBack }: { onBack: () => void }) {
  const n = useNutrition();
  const p = useWorkoutResource({
    path: '/api/user/profile',
    ttl: 300000,
    schema: z.object({ user: profile }),
  });
  const g = useWorkoutResource({ path: '/api/user/goals', ttl: 300000, schema: goals });
  return (
    <PageLayout
      title="Profile & goals"
      header={
        <Stack direction="row" align="center">
          <IconButton icon="back" label="Back to More" onPress={onBack} />
          <AppText variant="heading" style={{ flex: 1 }}>
            Profile & goals
          </AppText>
          <StatusIndicator
            label="Profile and goals"
            busy={p.loading || g.loading}
            error={p.error ?? g.error}
            onRetry={() => {
              p.refresh();
              g.refresh();
            }}
          />
        </Stack>
      }
    >
      {!p.connected ? (
        <AppText>Sign in from Account & settings to edit your profile and goals.</AppText>
      ) : p.data && g.data ? (
        <ProfileGoalsForm
          key={n.store?.connection.userId}
          user={p.data.user}
          goals={g.data}
          onSaved={() => {
            p.refresh();
            g.refresh();
          }}
        />
      ) : (
        <Stack>
          <Card>
            <Skeleton style={{ height: 240 }} />
          </Card>
          <Card>
            <Skeleton style={{ height: 240 }} />
          </Card>
        </Stack>
      )}
    </PageLayout>
  );
}
function ProfileGoalsForm({
  user,
  goals: stored,
  onSaved,
}: {
  user: z.infer<typeof profile>;
  goals: z.infer<typeof goals>;
  onSaved: () => void;
}) {
  const n = useNutrition();
  const resources = useWorkoutResources();
  const energy = useWorkoutResource(energySpec(n.today));
  const draft = useWorkoutDraft('profile-goals', formSchema, {
    profile: Object.fromEntries(
      ['displayName', 'heightCm', 'dateOfBirth', 'sex', 'activityLevel', 'fitnessGoal'].map(
        (k) => [k, user[k] == null ? '' : String(user[k])],
      ),
    ),
    goals: Object.fromEntries(
      [
        'stepsGoal',
        'stepsGoalType',
        'sleepGoalHours',
        'waterGoalMl',
        'waterGoalType',
        'targetWeightKg',
        'targetBfPct',
        'calorieGoal',
      ].map((k) => [
        k,
        stored[k] == null ? (k.endsWith('Type') ? 'daily' : '') : String(stored[k]),
      ]),
    ),
    own: stored.calorieGoalType === 'own',
  });
  const f = draft.value;
  const [edit, setEdit] = useState(false);
  const [targets, setTargets] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setProfile = (k: string, v: string) =>
    draft.setValue({ ...f, profile: { ...f.profile, [k]: v } });
  const setGoal = (k: string, v: string) =>
    draft.setValue({ ...f, goals: { ...f.goals, [k]: v } });
  async function save() {
    setBusy(true);
    try {
      const body = goalsBody.parse(
        Object.fromEntries([
          ...[
            'stepsGoal',
            'sleepGoalHours',
            'waterGoalMl',
            'targetWeightKg',
            'targetBfPct',
          ].map((k) => [k, f.goals[k]?.trim() ? Number(f.goals[k]) : null]),
          ['stepsGoalType', f.goals.stepsGoalType],
          ['waterGoalType', f.goals.waterGoalType],
          [
            'calorieGoal',
            f.own && f.goals.calorieGoal?.trim() ? Number(f.goals.calorieGoal) : null,
          ],
          ['calorieGoalType', f.own ? 'own' : 'daily'],
        ]),
      );
      await resources!.write('PATCH', '/api/user/goals', body, [
        '/api/user/goals',
        '/api/nutrition',
        '/api/body-metadata',
        '/api/progress-summary',
      ]);
      await resources!.write(
        'PATCH',
        '/api/user/profile',
        { fitnessGoal: f.profile.fitnessGoal || null },
        ['/api/user/profile', '/api/nutrition'],
      );
      await resources!.clearDraft('profile-goals');
      setError(null);
      onSaved();
    } catch {
      setError(
        'Could not save goals. Check the target values and retry when connected. Your edits are preserved.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <TabPanel>
        <ProfileOverview />
        <Card>
          <AppText variant="heading">{user.displayName ?? 'Your profile'}</AppText>
          <ListRow
            title="Edit profile"
            subtitle="Height, date of birth, sex and activity level"
            onPress={() => setEdit(true)}
          />
        </Card>
        <Card>
          <Stack direction="row" justify="space-between">
            <AppText variant="heading">My goals</AppText>
            <StatusIndicator label="Goals" busy={busy} error={error ?? draft.error} />
          </Stack>
          <Picker
            label="Fitness goal"
            value={f.profile.fitnessGoal}
            options={[
              { value: '', label: 'Not set' },
              ...FITNESS_GOALS.map((v) => ({ value: v, label: v.replaceAll('_', ' ') })),
            ]}
            onChange={(value) => setProfile('fitnessGoal', value)}
          />
          {[
            ['stepsGoal', 'Steps'],
            ['waterGoalMl', 'Water (ml)'],
            ['sleepGoalHours', 'Sleep (hours)'],
            ['targetWeightKg', 'Target weight (kg)'],
            ['targetBfPct', 'Target body fat (%)'],
          ].map(([k, label]) => (
            <Stack key={k}>
              <TextField
                label={label}
                keyboardType="decimal-pad"
                value={f.goals[k]}
                onChangeText={(v) => setGoal(k, v)}
              />
              {(k === 'stepsGoal' || k === 'waterGoalMl') && (
                <Picker
                  label={label + ' period'}
                  value={f.goals[k === 'stepsGoal' ? 'stepsGoalType' : 'waterGoalType']}
                  options={[
                    { value: 'daily', label: 'Daily' },
                    { value: 'weekly', label: 'Weekly' },
                  ]}
                  onChange={(v) =>
                    setGoal(k === 'stepsGoal' ? 'stepsGoalType' : 'waterGoalType', v)
                  }
                />
              )}
            </Stack>
          ))}
          <Disclosure title="Calorie budget" defaultOpen>
            <AppText tone="muted">
              {energy.data?.balance?.budgetKcal == null
                ? 'Complete your profile to calculate a daily budget.'
                : `Today’s budget: ${Math.round(energy.data.balance.budgetKcal)} kcal`}
            </AppText>
            <SwitchRow
              label="Use my own calorie target"
              value={f.own}
              onValueChange={(own) => draft.setValue({ ...f, own })}
            />
            {f.own && (
              <TextField
                label="Own daily calorie target"
                keyboardType="decimal-pad"
                value={f.goals.calorieGoal}
                onChangeText={(v) => setGoal('calorieGoal', v)}
              />
            )}
            <AppText variant="caption" tone="muted">
              Without an own target, the daily budget follows resting rate, your goal and
              movement.
            </AppText>
          </Disclosure>
          <AppButton title="Macro targets" variant="surface" onPress={() => setTargets(true)} />
          <AppButton
            title="Save goals"
            busy={busy}
            disabled={!draft.ready}
            onPress={() => void save()}
          />
          <AppButton
            title="Review my goals"
            variant="secondary"
            onPress={() => setReview(true)}
          />
        </Card>
      </TabPanel>
      <Sheet
        visible={edit}
        fullHeight
        title="Edit profile"
        onClose={() => setEdit(false)}
        actions={
          <StatusIndicator label="Profile editor" busy={busy} error={error ?? draft.error} />
        }
      >
        <TextField
          label="Display name"
          value={f.profile.displayName}
          onChangeText={(v) => setProfile('displayName', v)}
        />
        <TextField
          label="Height (cm)"
          value={f.profile.heightCm}
          keyboardType="decimal-pad"
          onChangeText={(v) => setProfile('heightCm', v)}
        />
        <TextField
          label="Date of birth (YYYY-MM-DD)"
          value={f.profile.dateOfBirth}
          onChangeText={(v) => setProfile('dateOfBirth', v)}
        />
        <Picker
          label="Sex"
          value={f.profile.sex}
          options={[
            { value: '', label: 'Not set' },
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
            { value: 'other', label: 'Other' },
          ]}
          onChange={(v) => setProfile('sex', v)}
        />
        <Picker
          label="Activity level"
          value={f.profile.activityLevel}
          options={[
            { value: '', label: 'Not set' },
            ...ACTIVITY_LEVELS.map((v) => ({ value: v, label: v.replaceAll('_', ' ') })),
          ]}
          onChange={(v) => setProfile('activityLevel', v)}
        />
        <Picker
          label="Food search region"
          value={n.region}
          options={[
            { value: 'AU', label: 'Australia' },
            { value: 'NZ', label: 'New Zealand' },
            { value: 'US', label: 'United States' },
            { value: 'GB', label: 'United Kingdom' },
            { value: 'CA', label: 'Canada' },
          ]}
          onChange={n.setRegion}
        />
        <AppButton
          title="Save profile"
          busy={busy}
          disabled={!draft.ready}
          onPress={async () => {
            setBusy(true);
            try {
              await resources!.write(
                'PATCH',
                '/api/user/profile',
                {
                  displayName: f.profile.displayName || null,
                  heightCm: f.profile.heightCm.trim() ? Number(f.profile.heightCm) : null,
                  dateOfBirth: f.profile.dateOfBirth || null,
                  sex: f.profile.sex || null,
                  activityLevel: f.profile.activityLevel || null,
                },
                ['/api/user/profile', '/api/nutrition'],
              );
              setEdit(false);
              setError(null);
              onSaved();
            } catch {
              setError('Check the profile fields and retry when connected.');
            } finally {
              setBusy(false);
            }
          }}
        />
      </Sheet>
      {targets && <NutritionTargets onClose={() => setTargets(false)} />}
      {review && (
        <GoalRecommendation
          onClose={() => setReview(false)}
          onApplied={(changes) => {
            if (changes) {
              draft.setValue({
                ...f,
                goals: {
                  ...f.goals,
                  ...Object.fromEntries(
                    Object.entries(changes.goals).map(([key, value]) => [key, String(value)]),
                  ),
                },
                profile: {
                  ...f.profile,
                  ...(changes.activityLevel ? { activityLevel: changes.activityLevel } : {}),
                },
              });
            }
            onSaved();
          }}
        />
      )}
    </>
  );
}
