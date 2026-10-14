import { useState } from 'react';
import { z } from 'zod';
import {
  AppText,
  AppButton,
  Card,
  Disclosure,
  Stack,
  StatusIndicator,
  TextField,
} from '../../../shared/ui';
import { WorkoutLayout } from '../../workouts/components/WorkoutLayout';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useHealthData } from '../data/HealthDataProvider';
import { clinicalFields, type ClinicalField } from '../data/clinical-fields';
import {
  clinicalDraftSchema,
  clinicalPayload,
  rmrSpec,
  dexaSpec,
  rmrSchema,
  dexaSchema,
} from '../data/clinical';
import { metricValue } from '../data/models';
import { HealthViewReady } from '../components/HealthViewReady';
import { HealthResourceHeader } from '../components/HealthResourceHeader';
type Rmr = z.infer<typeof rmrSchema>;
type Dexa = z.infer<typeof dexaSchema>;
function ClinicalForm({
  kind,
  onSaved,
}: {
  kind: 'rmr' | 'dexa';
  onSaved: (record: Rmr | Dexa) => void;
}) {
  const { today } = useHealthData();
  const date = kind === 'rmr' ? 'measuredOn' : 'scannedOn';
  const draft = useWorkoutDraft(`clinical:${kind}`, clinicalDraftSchema, { [date]: today });
  const required = draft.value[kind === 'rmr' ? 'rmrKcal' : 'pctFat'] ?? '';
  const requiredValid =
    !!required.trim() &&
    (kind === 'rmr' ? rmrSchema.shape.rmrKcal : dexaSchema.shape.pctFat).safeParse(
      Number(required),
    ).success;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const set = (key: string, value: string) => {
    setSaved(false);
    draft.setValue((fields) => ({ ...fields, [key]: value }));
  };
  const field = (field: ClinicalField) => (
    <TextField
      key={field.key}
      label={`${field.label}${field.unit ? ` (${field.unit})` : ''}`}
      hint={field.hint}
      value={draft.value[field.key] ?? ''}
      error={issues[field.key]}
      onChangeText={(value) => set(field.key, value)}
      keyboardType={field.text ? 'default' : 'numbers-and-punctuation'}
      editable={draft.ready && !saving}
      multiline={field.key === 'notes'}
    />
  );
  async function save() {
    if (!draft.resources || !draft.ready || saving) {
      return;
    }
    setError(null);
    setIssues({});
    setSaving(true);
    setSaved(false);
    try {
      const payload = clinicalPayload(kind, draft.value);
      if (kind === 'dexa' && (!('pctFat' in payload) || payload.pctFat == null)) {
        setIssues({ pctFat: 'Enter total body fat from the scan.' });
        return;
      }
      await draft.resources.write(
        'POST',
        kind === 'rmr' ? rmrSpec.path : dexaSpec.path,
        payload,
        [
          rmrSpec.path,
          dexaSpec.path,
          '/api/body-metadata',
          '/api/nutrition/energy-balance',
          '/api/nutrition-goals/recommend',
        ],
      );
      onSaved(payload);
      setSaved(true);
      const retained = { ...draft.value };
      for (const group of Object.values(clinicalFields[kind])) {
        for (const f of group) {
          if (!f.text || f.key === 'notes') {
            retained[f.key] = '';
          }
        }
      }
      draft.setValue(retained);
    } catch (cause) {
      if (cause instanceof z.ZodError) {
        setIssues(
          Object.fromEntries(
            cause.issues.map((issue) => [String(issue.path[0]), issue.message]),
          ),
        );
        setError('Check the highlighted fields.');
      } else {
        setError(
          'Could not save. Your draft is still here; check your connection and try again.',
        );
      }
    } finally {
      setSaving(false);
    }
  }
  const status = (
    <StatusIndicator
      label="Clinical result"
      busy={!draft.ready || saving}
      error={error ?? draft.error}
      message={saved ? 'Saved to your account.' : null}
    />
  );
  return (
    <Stack gap="md">
      <Stack direction="row" align="center">
        <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
          Enter values from your report
        </AppText>
        {status}
      </Stack>
      <TextField
        label={kind === 'rmr' ? 'Test date (YYYY-MM-DD)' : 'Scan date (YYYY-MM-DD)'}
        value={draft.value[date] ?? today}
        onChangeText={(value) => set(date, value)}
        error={issues[date]}
        editable={draft.ready && !saving}
      />
      {clinicalFields[kind][''].map(field)}
      {kind === 'rmr' && (
        <AppText variant="caption" tone="muted">
          The app works from this test re-scaled onto your current lean mass, so its day-to-day
          resting rate can differ from the number entered.
        </AppText>
      )}
      {Object.entries(clinicalFields[kind])
        .filter(([title]) => title)
        .map(([title, fields]) => (
          <Disclosure
            key={`${title}:${fields.some((f) => issues[f.key])}`}
            title={title}
            defaultOpen={fields.some((f) => issues[f.key])}
          >
            <Stack gap="md">{fields.map(field)}</Stack>
          </Disclosure>
        ))}
      <AppButton
        title={kind === 'rmr' ? 'Save RMR test' : 'Save DEXA scan'}
        busy={saving}
        disabled={!draft.ready || !requiredValid}
        onPress={() => void save()}
      />
    </Stack>
  );
}
export function ClinicalScreen({ onBack }: { onBack: () => void }) {
  const rmr = useWorkoutResource(rmrSpec);
  const dexa = useWorkoutResource(dexaSpec);
  const [savedRmr, setRmr] = useState<Rmr | null>(null);
  const [savedDexa, setDexa] = useState<Dexa | null>(null);
  const latestRmr = savedRmr ?? rmr.data?.tests[0];
  const latestDexa = savedDexa ?? dexa.data?.scans[0];
  return (
    <WorkoutLayout
      title="DEXA & RMR"
      onBack={onBack}
      backLabel="Back to More"
      actions={
        <StatusIndicator
          label="Clinical results"
          busy={rmr.loading || dexa.loading}
          error={rmr.error ?? dexa.error}
          onRetry={() => {
            rmr.refresh();
            dexa.refresh();
          }}
        />
      }
    >
      <AppText variant="caption" tone="muted">
        Results from a body-composition scan or a metabolic test. A measured resting rate
        replaces the app’s predicted one in your calorie target, and a scan calibrates your
        scale’s body-fat reading.
      </AppText>
      <HealthViewReady view="clinical" requests={[rmrSpec, dexaSpec]}>
        <Card>
          <HealthResourceHeader
            title="Resting metabolic rate"
            state={rmr}
            refresh={rmr.refresh}
          />
          {latestRmr ? (
            <>
              <AppText variant="title">{metricValue(latestRmr.rmrKcal, 'kcal/day')}</AppText>
              <AppText variant="caption" tone="muted">
                Measured {latestRmr.measuredOn}
                {latestRmr.ffmKgAtTest != null
                  ? ` · at ${latestRmr.ffmKgAtTest} kg fat-free mass`
                  : ''}
              </AppText>
              {latestRmr.ffmKgAtTest == null && (
                <AppText variant="caption" tone="muted">
                  No fat-free mass recorded, so this cannot be re-scaled as your lean mass
                  changes.
                </AppText>
              )}
            </>
          ) : (
            <AppText variant="caption" tone="muted">
              {rmr.error
                ? 'Could not load your tests.'
                : 'No test stored — your calorie target is using a predicted rate.'}
            </AppText>
          )}
        </Card>
        <Card>
          <HealthResourceHeader title="Latest DEXA scan" state={dexa} refresh={dexa.refresh} />
          {latestDexa ? (
            <>
              <AppText variant="title">
                {metricValue(latestDexa.pctFat, '%', 1)} body fat
              </AppText>
              <AppText variant="caption" tone="muted">
                Scanned {latestDexa.scannedOn}
              </AppText>
            </>
          ) : (
            <AppText variant="caption" tone="muted">
              {dexa.error
                ? 'Could not load your scans.'
                : 'No scan stored — nothing is calibrating your scale’s body-fat reading.'}
            </AppText>
          )}
        </Card>
        <Disclosure title="Add an RMR test" defaultOpen={!latestRmr}>
          <ClinicalForm
            kind="rmr"
            onSaved={(record) => {
              setRmr(record as Rmr);
              rmr.refresh();
            }}
          />
        </Disclosure>
        <Disclosure title="Add a DEXA scan" defaultOpen={!latestDexa}>
          <ClinicalForm
            kind="dexa"
            onSaved={(record) => {
              setDexa(record as Dexa);
              dexa.refresh();
            }}
          />
        </Disclosure>
      </HealthViewReady>
    </WorkoutLayout>
  );
}
