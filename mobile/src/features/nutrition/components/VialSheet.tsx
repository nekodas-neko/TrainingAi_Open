import { isCalendarDate } from '@trainingai/shared/date-utils';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  ConfirmationCard,
  Disclosure,
  Grid,
  LineChart,
  ListRow,
  Sheet,
  Stack,
  StatusIndicator,
  TextField,
} from '../../../shared/ui';
import { useHealthData } from '../../health/data/HealthDataProvider';
import {
  useWorkoutResource,
  useWorkoutResources,
} from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useNutrition } from '../data/NutritionProvider';
import { confirmedCreate, UnconfirmedCreate } from '../data/confirmed-create';
import { heartCardView } from '../data/heart-response-view';
import { type Supplement } from '../data/models';
import { openedOnProblem } from '../data/vial-date';
import { concentrationWorking, doseWorking, planDose } from '../data/vial-plan';
import { formatRange, recoveryResponse, weightResponse } from '../data/weight-response';
const vialSchema = z
  .object({
    id: z.string(),
    strengthMg: z.number().positive(),
    waterMl: z.number().positive(),
    syringeUnitsPerMl: z.number().positive(),
    openedOn: z.string(),
  })
  .passthrough();
const formSchema = z.object({
  seeded: z.boolean().default(false),
  strengthMg: z.string(),
  waterMl: z.string(),
  syringeUnitsPerMl: z.string(),
  openedOn: z.string(),
  mg: z.string(),
});
const bodySchema = z.object({
  strengthMg: z.number().positive().max(10000),
  waterMl: z.number().positive().max(1000),
  syringeUnitsPerMl: z.number().positive().max(1000),
  openedOn: z.string().refine(isCalendarDate),
});
export function VialSheet({
  supplement,
  onClose,
}: {
  supplement: Supplement;
  onClose: () => void;
}) {
  const n = useNutrition();
  const resources = useWorkoutResources();
  const path = `/api/supplements/${supplement.id}/vials`;
  const state = useWorkoutResource({
    path,
    schema: z.object({ vials: z.array(vialSchema) }),
    ttl: 300000,
  });
  const current = state.data?.vials[0];
  const [edit, setEdit] = useState<z.infer<typeof vialSchema> | null>(null);
  const [remove, setRemove] = useState<z.infer<typeof vialSchema> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const draft = useWorkoutDraft(
    'vial:' + supplement.id + ':' + (edit?.id ?? 'new'),
    formSchema,
    {
      seeded: false,
      strengthMg: edit ? String(edit.strengthMg) : '',
      waterMl: edit ? String(edit.waterMl) : '',
      syringeUnitsPerMl: String(edit?.syringeUnitsPerMl ?? 100),
      openedOn: edit?.openedOn ?? n.today,
      mg: String(supplement.defaultAmount ?? ''),
    },
  );
  const d = draft.value;
  useEffect(() => {
    if (draft.ready && !d.seeded && state.data) {
      draft.setValue({
        ...d,
        ...(!edit && current && !d.strengthMg.trim() && !d.waterMl.trim()
          ? {
              strengthMg: String(current.strengthMg),
              waterMl: String(current.waterMl),
              syringeUnitsPerMl: String(current.syringeUnitsPerMl),
            }
          : {}),
        seeded: true,
      });
    }
  }, [draft.ready, d.seeded, state.data, edit]);
  const mixture = {
    strengthMg: Number(d.strengthMg),
    waterMl: Number(d.waterMl),
    syringeUnitsPerMl: Number(d.syringeUnitsPerMl),
  };
  const problem = openedOnProblem(d.openedOn, n.today);
  const plan = d.mg.trim() ? planDose(Number(d.mg), mixture, mixture.syringeUnitsPerMl) : null;
  async function save() {
    if (!resources || busy) {
      return;
    }
    setBusy(true);
    try {
      const body = bodySchema.parse({ ...mixture, openedOn: d.openedOn });
      if (problem) {
        throw new Error(problem);
      }
      if (edit) {
        await resources.write('PATCH', path + '/' + edit.id, body, ['/api/supplements']);
      } else {
        await confirmedCreate(
          resources,
          path,
          body,
          async () =>
            z.object({ vials: z.array(vialSchema) }).parse(await resources.connection.get(path))
              .vials,
          (row, p) => Object.entries(p).every(([key, value]) => row[key] === value),
        );
      }
      await resources.clearDraft('vial:' + supplement.id + ':' + (edit?.id ?? 'new'));
      state.refresh();
      onClose();
    } catch (cause) {
      setUnconfirmed(cause instanceof UnconfirmedCreate);
      setError(
        cause instanceof UnconfirmedCreate
          ? cause.message
          : 'Could not save this vial. Check the fields and retry when connected. Your draft is preserved.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Sheet
        visible
        fullHeight
        title={supplement.name + ' · vial & dose'}
        onClose={onClose}
        actions={
          <StatusIndicator
            label="Vials"
            busy={busy || state.loading}
            error={error ?? draft.error ?? state.error}
            onRetry={state.refresh}
          />
        }
        footer={
          <AppButton
            title={
              unconfirmed
                ? 'Check previous save'
                : edit
                  ? 'Save vial correction'
                  : current
                    ? 'Save as a new vial'
                    : 'Save vial'
            }
            busy={busy}
            disabled={!draft.ready || !concentrationWorking(mixture) || !!problem}
            onPress={() => {
              // A new vial restarts the response window, so it asks first. Retrying a save that
              // may already have gone through (`unconfirmed`) has its own check.
              if (current && !edit && !unconfirmed) setConfirmNew(true);
              else void save();
            }}
          />
        }
      >
        {current && (
          <Card>
            <AppText variant="heading">The vial you’re using</AppText>
            <ListRow
              title={'Opened ' + current.openedOn}
              subtitle={`${current.strengthMg} mg · ${current.waterMl} ml · ${current.syringeUnitsPerMl} marks/ml`}
              onPress={() => setEdit(current)}
            />
            <AppButton title="Change" variant="ghost" onPress={() => setEdit(current)} />
          </Card>
        )}
        <AppText variant="heading">
          {edit ? 'Correct this vial' : current ? 'Open a new vial' : 'Your vial'}
        </AppText>
        <Grid columns={2}>
          <TextField
            label="Peptide (mg)"
            value={d.strengthMg}
            keyboardType="decimal-pad"
            onChangeText={(strengthMg) => draft.setValue({ ...d, strengthMg })}
          />
          <TextField
            label="Bac water (ml)"
            value={d.waterMl}
            keyboardType="decimal-pad"
            onChangeText={(waterMl) => draft.setValue({ ...d, waterMl })}
          />
        </Grid>
        <TextField
          label="Marks on the barrel (per ml)"
          value={d.syringeUnitsPerMl}
          keyboardType="decimal-pad"
          onChangeText={(syringeUnitsPerMl) => draft.setValue({ ...d, syringeUnitsPerMl })}
        />
        <TextField
          label="Opened on (YYYY-MM-DD)"
          value={d.openedOn}
          onChangeText={(openedOn) => draft.setValue({ ...d, openedOn })}
        />
        <AppText variant="caption" tone={problem ? 'danger' : 'muted'}>
          {problem ??
            concentrationWorking(mixture) ??
            'Enter peptide and water to get a concentration.'}
        </AppText>
        {edit && (
          <AppButton
            title="Open a new vial instead"
            variant="ghost"
            onPress={() => setEdit(null)}
          />
        )}
        <Card>
          <AppText variant="heading">Work out the units</AppText>
          <TextField
            label="Try a dose (mg)"
            value={d.mg}
            keyboardType="decimal-pad"
            onChangeText={(mg) => draft.setValue({ ...d, mg })}
          />
          <AppText variant="caption" tone="muted">
            This calculation is not a logged dose.{' '}
            {supplement.defaultAmount == null
              ? 'No saved dose yet.'
              : `Your saved dose is ${supplement.defaultAmount} mg.`}
          </AppText>
          <AppText>{d.mg.trim() ? (doseWorking(Number(d.mg), mixture) ?? '—') : '—'}</AppText>
          <AppText variant="title">
            {plan?.units == null ? '—' : Number(plan.units.toFixed(1)) + ' units'}
          </AppText>
          {plan?.exceedsBarrel && (
            <AppText tone="danger">
              More than one {mixture.syringeUnitsPerMl}-unit barrel holds.
            </AppText>
          )}
          {plan?.dosesInVial != null && (
            <AppText variant="caption">{plan.dosesInVial} doses this size in the vial.</AppText>
          )}
        </Card>
        <VialResponses supplement={supplement} since={current?.openedOn ?? null} />
        <Disclosure title="Vial history">
          {state.data?.vials.map((v) => (
            <Stack key={v.id} direction="row" align="center">
              <ListRow
                title={v.openedOn}
                subtitle={`${v.strengthMg} mg · ${v.waterMl} ml`}
                onPress={() => setEdit(v)}
              />
              <AppButton title="Delete" variant="ghost" onPress={() => setRemove(v)} />
            </Stack>
          ))}
        </Disclosure>
        {current && !edit && (
          <AppText variant="caption" tone="muted">
            A new vial restarts the response window. Use Change to correct the existing vial.
          </AppText>
        )}
        {unconfirmed && (
          <ConfirmationCard
            title="Start another save?"
            message="Check Vial history first. If the earlier vial appears, use Check previous save. Starting another save may create a duplicate."
            confirmLabel="Start another save"
            cancelLabel="Keep checking"
            onCancel={() => setUnconfirmed(false)}
            onConfirm={async () => {
              await resources?.clearDraft('nutrition-create:' + path);
              setUnconfirmed(false);
              setError(null);
            }}
          />
        )}
      </Sheet>
      <Sheet visible={confirmNew} title="Save as a new vial" onClose={() => setConfirmNew(false)}>
        <ConfirmationCard
          title="Save as a new vial?"
          message="A new vial restarts the response window. To correct the vial you are using, cancel and choose Change on it instead."
          confirmLabel="Save as a new vial"
          cancelLabel="Cancel"
          onCancel={() => setConfirmNew(false)}
          onConfirm={() => {
            setConfirmNew(false);
            void save();
          }}
        />
      </Sheet>
      <Sheet visible={remove !== null} title="Delete vial" onClose={() => setRemove(null)}>
        {remove && (
          <ConfirmationCard
            title={'Delete vial opened ' + remove.openedOn + '?'}
            message="Recorded doses retain their saved concentration."
            confirmLabel="Delete"
            cancelLabel="Cancel"
            danger
            onCancel={() => setRemove(null)}
            onConfirm={async () => {
              try {
                await resources!.write('DELETE', path + '/' + remove.id, {}, [
                  '/api/supplements',
                ]);
                setRemove(null);
                state.refresh();
              } catch {
                setError('Could not delete the vial.');
              }
            }}
          />
        )}
      </Sheet>
    </>
  );
}
const inputsSchema = z.object({
  doses: z.array(
    z.object({
      supplementId: z.string(),
      supplementName: z.string(),
      date: z.string(),
      amount: z.number().nullable(),
      unit: z.string().nullable(),
      doseText: z.string().nullable(),
      takenAt: z.string().nullable(),
    }),
  ),
  nights: z.array(
    z.object({
      date: z.string(),
      restingHr: z.number().nullable(),
      hrvMs: z.number().nullable(),
    }),
  ),
});
function VialResponses({
  supplement,
  since,
}: {
  supplement: Supplement;
  since: string | null;
}) {
  const n = useNutrition();
  const health = useHealthData();
  const { theme } = useTheme();
  const heart = useWorkoutResource({
    path: `/api/supplements/${supplement.id}/heart-response`,
    ttl: 300000,
    schema: inputsSchema,
  });
  const result = weightResponse({
    points: (health.body?.weightTrend ?? health.body?.recent ?? []).filter(
      (p) => since && p.date >= since,
    ),
  });
  const views = useMemo(
    () =>
      heart.data
        ? recoveryResponse({ ...heart.data, tz: n.timezone }).flatMap((s) =>
            [...s.levels].reverse().map(heartCardView),
          )
        : [],
    [heart.data, n.timezone],
  );
  return (
    <>
      <Card>
        <AppText variant="heading">Weight response</AppText>
        <AppText variant="caption" tone="muted">
          Since this vial
        </AppText>
        <Badge
          label={
            result?.verdict
              ? {
                  too_fast: 'Faster than your band',
                  in_band: 'In your band',
                  too_slow: 'Slower than your band',
                  gaining: 'Gaining',
                }[result.verdict]
              : result
                ? 'Not called yet'
                : 'Not enough weigh-ins yet'
          }
        />
        <AppText>
          {result
            ? formatRange(result)
            : 'Needs at least three weigh-ins on different days since this vial was opened.'}
        </AppText>
        {result && (
          <AppText variant="caption" tone="muted">
            Your band is {result.bandLoKgPerWeek.toFixed(2)}–{result.bandHiKgPerWeek.toFixed(2)}{' '}
            kg/wk. {result.weighIns} weigh-ins over {Math.round(result.spanDays)} days. A range
            crossing a boundary is not called either way.
          </AppText>
        )}
      </Card>
      <Card>
        <Stack direction="row" justify="space-between">
          <AppText variant="heading">Heart after a dose</AppText>
          <StatusIndicator
            label="Heart after a dose"
            busy={heart.loading}
            error={heart.error}
            onRetry={heart.refresh}
          />
        </Stack>
        {!views.length && (
          <AppText tone="muted">
            Needs two doses at the same amount with a few nights of readings. Different amounts
            are never pooled.
          </AppText>
        )}
        {views.map((v, i) => (
          <Stack key={v.levelLabel + i}>
            <AppText variant="label">{v.subtitle}</AppText>
            <Badge label={v.chip} />
            {v.sentence && <AppText>{v.sentence}</AppText>}
            {v.charts.map((c) => (
              <Stack key={c.metric}>
                <AppText variant="caption">
                  {c.title} ({c.unit})
                </AppText>
                <LineChart
                  label={c.title + ' by day after a ' + v.levelLabel + ' dose'}
                  interactive
                  points={c.points.map((p) => ({
                    label: 'Day ' + p.offset,
                    x: p.offset,
                    value: p.median,
                  }))}
                  bands={[
                    {
                      from: c.normal.low,
                      to: c.normal.high,
                      label: 'Your normal',
                      color: theme.colors.muted,
                    },
                  ]}
                  series={[
                    {
                      label: 'Lower middle half',
                      color: theme.colors.muted,
                      points: c.points.map((p) => ({ x: p.offset, value: p.p25 })),
                      dashed: true,
                    },
                    {
                      label: 'Upper middle half',
                      color: theme.colors.muted,
                      points: c.points.map((p) => ({ x: p.offset, value: p.p75 })),
                      dashed: true,
                    },
                  ]}
                  axisLabels={['Dose day', 'Days after dose']}
                />
              </Stack>
            ))}
          </Stack>
        ))}
        <AppText variant="micro" tone="muted">
          Middle of your doses; dashed lines show the middle half. Training, sleep and stress
          aren’t controlled. This shows a pattern, not proof.
        </AppText>
      </Card>
    </>
  );
}
