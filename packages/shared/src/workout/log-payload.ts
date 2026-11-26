import { z } from 'zod';
import { RPE_SOURCES } from './rpe-source';
import { ExerciseEffortSchema, SetEffortSchema } from './effort-vs-plan';
import { PushedEditedAtSchema } from '../sync/edited-at';

export const LogExercisePayloadSchema = z.object({
  sessionName:          z.string().min(1).max(200),
  sessionId:            z.string().uuid().optional(),
  workoutSessionId:     z.string().uuid().optional(),
  exerciseLogId:        z.string().uuid().optional(),
  setLogIds:            z.array(z.string().uuid()).optional(),
  exercise:             z.string().min(1).max(200),
  weights:              z.array(z.number().min(-100).max(500)).min(1).max(20),
  sets:                 z.number().int().min(1).max(20),
  reps:                 z.array(z.number().int().min(0).max(100)).min(1).max(20),
  localDate:            z.string().optional(),
  timeToCompleteSet:    z.number().int().min(0).max(86_400).optional(),
  setTimes:             z.array(z.number().int().min(0).max(86_400)).max(20).optional(),
  restTimes:            z.array(z.number().int().min(0).max(86_400)).max(20).optional(),
  setStartTimes:        z.array(z.number().int().min(1_600_000_000_000).max(4_100_000_000_000)).max(20).optional(),
  setEndTimes:          z.array(z.number().int().min(1_600_000_000_000).max(4_100_000_000_000)).max(20).optional(),
  interExerciseRestSec: z.number().int().min(0).max(86_400).optional(),
  prepTimeSec:          z.number().int().min(0).max(86_400).optional(),
  progressionStyle:     z.array(z.object({
    id:        z.string().optional(),
    styleId:   z.string().optional(),
    setNumber: z.number().optional(),
    pct:       z.number(),
    reps:      z.number(),
    restSec:   z.number(),
    useFor1rm: z.boolean().optional(),
  })).optional(),
  prescriptionBasisKg: z.number().positive().max(1000).optional(),
  /** #3896: the `liftPreference.oneShotSetAt` of the plan this log was made from (ISO). Only ever compared
   *  with the stored one-shot's own write time to decide whether this plan carried it; never stored. */
  liftOneShotSetAt:     z.string().datetime().max(40).optional(),
  plannedWeights:       z.array(z.number().min(0).max(500).nullable()).max(20).optional(),
  styleName:            z.string().optional(),
  styleId:              z.string().optional(),
  muscleGroups:         z.array(z.string()).optional(),
  workoutStartedAt:     z.number().optional(),
  warmupEndedAtMs:      z.number().optional(),
  rpeValues:            z.array(z.number().int().min(5).max(10)).optional(),
  rpeSources:           z.array(z.enum(RPE_SOURCES).nullable()).max(20).optional(),
  intensityMode:        z.enum(['full', 'deload']).optional(),
  wasOverride:          z.boolean().optional(),
  exerciseDeloaded:     z.boolean().optional(),
  // #3745: "how did this exercise feel?", answered after its last set. Optional: an older build
  // sends none, and the server then keeps whatever answer the row already holds.
  effort:               ExerciseEffortSchema.optional(),
  // #4159: "how did that set feel?", one entry per set (`null` where it was not asked). Stored with
  // the set; the server does not derive the exercise's answer from it and nothing reads it to decide.
  // Optional: every build in the field sends none, and the server then keeps any answer a set holds.
  setEfforts:           z.array(SetEffortSchema.nullable()).min(1).max(20).optional(),
  estimated1rm:         z.number().optional(),
  target80:             z.number().optional(),
  // Issue 2721: when the phone made this log (epoch ms), for the outbox push. A stale copy older than
  // the server's last decided edit is skipped. Optional: an old client, or a stamp from a broken
  // clock, is applied as before, and the direct POST route ignores it and stamps server time.
  editedAt:             PushedEditedAtSchema,
}).superRefine((p, ctx) => {
  // Index-aligned with `weights`: a shorter or longer list would put an answer on the wrong set.
  if (p.setEfforts && p.setEfforts.length !== p.weights.length) {
    ctx.addIssue({ code: 'custom', path: ['setEfforts'], message: 'setEfforts must have one entry per set' });
  }
});

export type LogExercisePayload = z.infer<typeof LogExercisePayloadSchema>;
