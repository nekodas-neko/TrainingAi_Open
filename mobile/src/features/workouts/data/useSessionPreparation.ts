import { useEffect, useRef, useState } from 'react';
import { readDurationPreset, type DurationPreset } from '@trainingai/shared/workout/duration-model';
import {
  hidePrescriptionAgedOutOnScreen,
  prescribedDeloadDefault,
} from '@trainingai/shared/ai-periodization/prescription-expiry';
import { readSessionResponse, type SessionPreview } from '../catalog';
import { DELOAD_FAILED, deloadChoice } from './deload-choice';
import { prepareSession, type SessionStartOptions } from '../logging/session-options';
import { useWorkoutResource, useWorkoutResources } from './WorkoutDataProvider';
import { periodizationSpec, sessionPreparationSchema } from './models';
import { useWorkoutAction } from './useWorkoutAction';
import { failureNotice } from '../../../core/reporting/index.ts';

export function useSessionPreparation(
  session: SessionPreview | undefined,
  programId: string | undefined,
  ai: boolean,
  initialFullOverride = false,
) {
  const resources = useWorkoutResources();
  const [deload, setDeload] = useState(false);
  const chosen = useRef(false);
  const [duration, setDuration] = useState<DurationPreset | undefined>();
  const [reverted, setReverted] = useState<string[]>([]);
  const [deloadFailure, setDeloadFailure] = useState<string | null>(null);
  const action = useWorkoutAction();
  const state = useWorkoutResource(
    periodizationSpec(session?.id ?? 'missing'),
    !!session && ai,
  );
  // Two reads, never one keyed by the choice: the full plan is always there to fall back to, and the
  // deload's own rows are drawn only once they have arrived (#4104).
  const fullSpec = {
    path: '/api/workout-data',
    query: { tab: session?.id ?? 'missing' },
    schema: sessionPreparationSchema,
    ttl: 60_000,
  };
  const deloadSpec = { ...fullSpec, query: { ...fullSpec.query, aiDeload: '1' } };
  const current = useWorkoutResource(fullSpec, !!session);
  const deloadCurrent = useWorkoutResource(deloadSpec, !!session && deload);
  // #3716: an aged-out prescription is not the plan. It is never the card, the Deload default or
  // something to Accept; opening the session (the workout-data read above) regenerates it. Read
  // from the expiry too, because production does not send `prescriptionAgedOut` and a saved
  // response can outlive the prescription it holds.
  const stored = state.data?.state;
  const prescribedState = stored ? hidePrescriptionAgedOutOnScreen(stored) : stored;
  useEffect(() => {
    chosen.current = initialFullOverride;
    setDeload(false);
    setDuration(undefined);
    setReverted([]);
    setDeloadFailure(null);
  }, [session?.id, initialFullOverride]);
  useEffect(() => {
    const raw = state.data?.state;
    setDuration(
      readDurationPreset(
        (raw ? hidePrescriptionAgedOutOnScreen(raw) : raw)?.prescription?.durationPreset,
      ),
    );
    // Yesterday's illness deload is not pre-selected once it has aged out (#3716).
    const adopted = prescribedDeloadDefault(raw);
    if (!chosen.current && adopted !== undefined) {
      setDeload(adopted);
    }
  }, [state.data]);
  let parseError: string | null = null;
  const read = (data: typeof current.data) => {
    if (!session || !programId || !data || !resources) {
      return undefined;
    }
    try {
      return {
        ...readSessionResponse(data, resources.connection, programId, session.id),
        durationMinutes: session.durationMinutes,
      };
    } catch (failure) {
      parseError ??= failureNotice(
        'This session changed while loading. Refresh it before starting.',
        failure,
        { apiPath: '/api/workout-data' },
      );
      return undefined;
    }
  };
  const fullRead = read(current.data);
  const deloadRead = deload ? read(deloadCurrent.data) : undefined;
  const prescribed = prescribedState?.prescription;
  // A prescribed deload already arrives deloaded on the full read; a deload the lifter picks needs
  // its own read. Either way it is the lifter's deload only once its rows are deloaded.
  const deloadSource = deloadRead ?? (prescribed?.deload ? fullRead : undefined);
  const choice = deloadChoice({
    requested: deload,
    prescribedDeload: !!prescribed?.deload,
    deloadRows: deloadRead?.exercises,
    fullRows: fullRead?.exercises,
    read: deloadCurrent,
  });
  const deloadReady = choice.ready;
  const deloadStatus = choice.status;
  // A deload that could not be loaded puts the screen back on the full plan, and says so.
  useEffect(() => {
    if (deloadStatus === 'failed') {
      setDeload(false);
      setDeloadFailure(DELOAD_FAILED);
    }
  }, [deloadStatus]);
  let prepared = deloadReady ? deloadSource : (fullRead ?? session);
  const options: SessionStartOptions = {
    aiDeload: deloadReady,
    fullOverride:
      !deloadReady &&
      (initialFullOverride ||
        (chosen.current &&
          !!(prescribed?.deload || prepared?.exercises.some((exercise) => exercise.deloaded)))),
    revertedExerciseIds: reverted,
    durationPreset: duration,
  };
  // #3330: the list as the server sent it, before Full puts weights back.
  const asSent = prepared?.exercises ?? [];
  if (prepared) {
    prepared = prepareSession(prepared, options);
  }
  async function update(
    action: 'accept' | 'dismiss' | 'prescribe' | 'transition',
    body: Record<string, unknown> = {},
  ) {
    if (!session || !resources) {
      throw new Error('Sign in to change the prescription.');
    }
    const path = `/api/ai-periodization/session/${session.id}/${action === 'accept' || action === 'dismiss' ? 'respond' : action}`;
    await resources.write(
      'POST',
      path,
      action === 'accept' || action === 'dismiss' ? { action } : body,
      ['/api/workout-data', '/api/ai-periodization', '/api/next-session'],
    );
    await Promise.all([
      resources.load(fullSpec, true),
      deload ? resources.load(deloadSpec, true) : Promise.resolve(),
      resources.load(periodizationSpec(session.id), true),
    ]);
  }
  return {
    session: prepared,
    asSent,
    state,
    /** The session's prescription state as the screen may use it: aged out → no prescription. */
    prescribedState,
    current,
    options,
    parseError,
    duration,
    /** The deload is what is drawn: it was chosen and its rows have loaded. */
    deload: deloadReady,
    /** A deload the lifter asked for that has not loaded yet: show the link busy. */
    deloadLoading: deloadStatus === 'loading',
    /** Why a deload the lifter asked for is not on screen; null otherwise. */
    deloadFailure,
    reverted,
    action,
    budget: session?.budgetMinutes ?? 60,
    chooseDeload: (value: boolean) => {
      chosen.current = true;
      setDeloadFailure(null);
      if (value && (deloadCurrent.error || (!deloadCurrent.data && !deloadCurrent.loading))) {
        deloadCurrent.refresh();
      }
      setDeload(value);
    },
    setDuration: async (value: DurationPreset) => {
      await update('prescribe', { durationPreset: value });
      setDuration(value);
    },
    regenerate: () => update('prescribe', { durationPreset: duration ?? 'standard' }),
    respond: (action: 'accept' | 'dismiss') => update(action),
    transition: async (newPhase: string, force = false) => {
      await update('transition', { newPhase, force });
      await update('prescribe', { durationPreset: duration ?? 'standard' });
    },
    toggleRevert: (id: string) =>
      setReverted(
        reverted.includes(id) ? reverted.filter((value) => value !== id) : [...reverted, id],
      ),
    refresh: () => {
      current.refresh();
      if (deload) {
        deloadCurrent.refresh();
      }
      state.refresh();
    },
  };
}
