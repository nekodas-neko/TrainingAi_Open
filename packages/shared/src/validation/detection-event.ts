// #2478. The wire contract for walk auto-detection's funnel events, shared by the phone's outbox
// (`lib/activity/detection-events.ts`) and `POST /api/activity-detection/events`.
//
// One detection is one GPS probe; its id is minted on the phone. Each detection emits each kind at
// most once, so (user, detectionId, kind) is the natural key and a retried batch inserts nothing
// new. The gate names the rule that decided the event; the list is documented, not enforced as an
// enum, so a new gate is recordable without changing the route (it must still be a short slug).
import { z } from 'zod'
import { isUuid } from './uuid'

export const DETECTION_EVENT_KINDS = ['candidate', 'confirmed', 'notified', 'offered', 'saved', 'dismissed'] as const
export type DetectionEventKind = typeof DETECTION_EVENT_KINDS[number]

/** Gates in use, by kind. Documentation for readers of `claude_ro.detection_events`. */
export const DETECTION_GATES = {
  candidate: ['ring_gait_window', 'phone_motion', 'always_on_gps', 'no_probe'],
  confirmed: ['ring_cadence', 'gps_speed'],
  notified: ['ring_cadence_no_fix', 'ring_cadence_gps', 'gps_distance_elapsed'],
  offered: ['quality_gates'],
  saved: ['user_review'],
  dismissed: [
    // Probe ended with no session.
    'probe_timeout', 'watcher_cap', 'session_owned', 'detection_stopped',
    // Session ended and failed a save-quality gate in `endSession`.
    'too_few_points', 'min_duration', 'min_distance', 'min_avg_speed', 'max_avg_speed', 'motorised_p80',
    // The user said no.
    'user_card', 'user_review',
  ],
} as const satisfies Record<DetectionEventKind, readonly string[]>

export const MAX_DETECTION_EVENTS_PER_POST = 50

// Structural bounds only: they keep a value inside `new Date()`'s range and the column types. A
// surprising but real number (a 40 km "walk" on a train) is exactly what this table must record.
const MAX_EPOCH_MS = 8_640_000_000_000_000
const finiteNonNeg = (max: number) => z.number().finite().min(0).max(max)

export const DetectionEventSchema = z.object({
  detectionId: z.string().refine(isUuid, 'Not a UUID'),
  kind: z.enum(DETECTION_EVENT_KINDS),
  gate: z.string().regex(/^[a-z0-9_]{1,40}$/),
  occurredAt: z.number().int().min(0).max(MAX_EPOCH_MS),
  trigger: z.enum(['ring', 'sensor']).nullable().optional(),
  activityType: z.enum(['walk', 'run']).nullable().optional(),
  sessionStartAt: z.number().int().min(0).max(MAX_EPOCH_MS).nullable().optional(),
  distanceM: finiteNonNeg(10_000_000).nullable().optional(),
  elapsedSec: finiteNonNeg(100_000_000).nullable().optional(),
  pointCount: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
  avgSpeedMs: finiteNonNeg(100_000).nullable().optional(),
}).strict()

export type DetectionEvent = z.infer<typeof DetectionEventSchema>

export const DetectionEventBatchSchema = z.object({
  events: z.array(DetectionEventSchema).min(1).max(MAX_DETECTION_EVENTS_PER_POST),
}).strict()
