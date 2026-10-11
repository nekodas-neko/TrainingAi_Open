import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { DurationPreset } from '@trainingai/shared/workout/duration-model';
import { readSessionResponse, type SessionPreview } from '../catalog';
import { prepareSession, type SessionStartOptions } from '../logging/session-options';
import { useWorkoutResource, useWorkoutResources } from './WorkoutDataProvider';
import { periodizationSpec } from './models';
import { useWorkoutAction } from './useWorkoutAction';

const response = z
  .object({
    program: z.unknown(),
    session: z.unknown(),
    exercises: z.array(z.unknown()),
    aiPrescriptionPending: z.boolean(),
  })
  .passthrough();
export function useSessionPreparation(
  session: SessionPreview | undefined,
  programId: string | undefined,
  ai: boolean,
) {
  const resources = useWorkoutResources();
  const [deload, setDeload] = useState(false);
  const chosen = useRef(false);
  const [duration, setDuration] = useState<DurationPreset | undefined>();
  const [reverted, setReverted] = useState<string[]>([]);
  const action = useWorkoutAction();
  const state = useWorkoutResource(periodizationSpec(session?.id ?? 'missing'), !!session && ai);
  const spec = {
    path: '/api/workout-data',
    query: { tab: session?.id ?? 'missing', ...(deload ? { aiDeload: '1' } : {}) },
    schema: response,
    ttl: 60_000,
  };
  const current = useWorkoutResource(spec, !!session);
  useEffect(() => {
    chosen.current = false;
    setDeload(false);
    setDuration(undefined);
    setReverted([]);
  }, [session?.id]);
  useEffect(() => {
    const prescribed = state.data?.state;
    if (
      !chosen.current &&
      prescribed?.prescriptionStatus !== 'consumed' &&
      prescribed?.prescription
    ) {
      setDeload(prescribed.prescription.deload);
    }
  }, [state.data]);
  let prepared = session;
  let parseError: string | null = null;
  if (session && programId && current.data && resources) {
    try {
      prepared = {
        ...readSessionResponse(current.data, resources.connection, programId, session.id),
        durationMinutes: session.durationMinutes,
      };
    } catch {
      parseError = 'This session changed while loading. Refresh it before starting.';
    }
  }
  const prescribed = state.data?.state?.prescription;
  const options: SessionStartOptions = {
    aiDeload: deload,
    fullOverride:
      chosen.current &&
      !deload &&
      !!(prescribed?.deload || prepared?.exercises.some((exercise) => exercise.deloaded)),
    revertedExerciseIds: reverted,
    durationPreset: duration,
  };
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
      resources.load(spec, true),
      resources.load(periodizationSpec(session.id), true),
    ]);
  }
  return {
    session: prepared,
    state,
    current,
    options,
    parseError,
    duration,
    deload,
    reverted,
    action,
    budget: session?.budgetMinutes ?? 60,
    chooseDeload: (value: boolean) => {
      chosen.current = true;
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
      state.refresh();
    },
  };
}
