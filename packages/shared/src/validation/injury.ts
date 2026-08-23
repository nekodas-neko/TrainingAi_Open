import { z } from 'zod'

// Q-484: `POST /api/injuries` had no schema at all while `PATCH /api/injuries/[id]` beside it had a
// complete one — same table, same fields. A 10 MB `notes` was accepted and stored; `muscleName` was
// checked only for non-emptiness; `startedDate` was passed through unvalidated and 500'd on
// "not-a-date". The PATCH schema already encoded the intended bounds, so create had only to reuse
// them — which is why both now come from one place rather than two that can drift.
//
// The asymmetry is worth understanding rather than just fixing: `CLAUDE.md` names `updateInjury` as
// *the reference* for Zod-whitelisting a body, and it is a good one. The rule was written about edit
// paths after an edit-path bug, and the create path beside it was never revisited.
const FIELDS = {
  muscleName:   z.string().min(1).max(100),
  notes:        z.string().max(1000).nullable(),
  severity:     z.enum(['mild', 'moderate', 'severe']),
  // Both separators, deliberately. The client's `localDateString()` emits **YYYY/MM/DD with
  // slashes**, so a dash-only regex rejects every such request with a Zod error before the handler
  // runs — invisible until a client happens to fill the field from that helper, which is how it bit
  // ai-chat's `localDate` for a full release. Today's injury clients use `todayInTz()` (dashes), so
  // nothing was broken; the point is that the failure mode is silent, not that it had fired.
  // Callers normalise to dashes before writing — the column is a DATE and `2026/08/09` is
  // DateStyle-dependent, so it must not reach the driver as-is.
  startedDate:  z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/),
  resolvedDate: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).nullable(),
}

/** SEC-I4: the web PATCH forwarded an unvalidated body — the adapter key-whitelists columns (no mass
 *  assignment) but never checked value types/enums, so the offline sync path was stricter than web. */
export const InjuryPatchSchema = z.object({
  muscleName:   FIELDS.muscleName.optional(),
  notes:        FIELDS.notes.optional(),
  severity:     FIELDS.severity.optional(),
  startedDate:  FIELDS.startedDate.optional(),
  resolvedDate: FIELDS.resolvedDate.optional(),
}).strict()

/** Create requires what the row cannot be written without; everything else keeps the PATCH bounds.
 *  `startedDate` stays optional because the route defaults it to today in the user's timezone. */
export const InjuryCreateSchema = z.object({
  muscleName:  FIELDS.muscleName,
  severity:    FIELDS.severity,
  notes:       FIELDS.notes.optional(),
  startedDate: FIELDS.startedDate.optional(),
}).strict()
