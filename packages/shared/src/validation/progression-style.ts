import { z } from 'zod'
import { promptSafeLine } from '../ai/untrusted-text'

// LA-74: `POST /api/progression-styles` had no schema at all — it spread the request body into
// `saveProgressionStyle`. That is **not** mass assignment (the repository names every column it
// writes), but nothing typed or bounded a value: `pct` could arrive as a string, `setNumber` as
// anything, and `name` was capped only by the route's 256 KB body limit. The route's two existing
// guards — name present, `sets` an array under 40 — read as validation while covering two fields.
//
// Q-484 fixed this same asymmetry on `POST /api/injuries`, and CLAUDE.md names `updateInjury` as
// the reference for whitelisting a body. This one was never revisited.
//
// **`.strict()`, per `scripts/check-strict-request-schemas.js`**, and it is affordable here because
// this shape has exactly one producer: `components/config-screen.tsx` builds
// `{ id?, name, sets: [{ setNumber, pct, reps, restSec, useFor1rm }] }` and nothing else posts to
// this route. `userId`, `id` and `styleId` are accepted anyway — a strict schema that rejects a key
// the GET shape carries is the fragile kind, and a style read back and posted again would carry
// them.
//
// The sibling program route is NOT done here. `POST /api/workout-templates` has two producers that
// demonstrably disagree — the editor omits `programId` on each session and `sessionId` on each
// exercise, while the activate button posts the whole stored row back with both — plus a two-variant
// `schedule` union. Strict there needs that enumeration checked against a device, and getting one
// key wrong breaks the app's core write path. It stays queued.

/** `''` is a real value on the id fields, not a missing one: the route passes `id ?? ''` and the
 *  repository branches on `if (style.id)`. A bare `.uuid()` would reject the create case. */
const optionalId = z.union([z.string().uuid(), z.literal('')]).optional()

/**
 * A stored name that reaches a prompt.
 *
 * **Deliberately no `.max()`.** `progression_styles.name` is `text`, so a longer name may already
 * be stored and a cap added here would start 400ing the save of a style that was fine yesterday.
 * The risk this addresses is structure, not length: `promptSafeLine` removes the newline that would
 * let a name occupy a line of a prompt, and `readJsonLimited` already bounds the body.
 *
 * `.min(1)` runs BEFORE the transform, so a name of only control characters passes the length check
 * and would arrive empty — hence the refine after.
 */
const promptSafeName = z.string().min(1)
  .transform(promptSafeLine)
  .refine(n => n.length > 0, { message: 'Name cannot be blank.' })

export const ProgressionStyleSaveSchema = z.object({
  id: optionalId,
  userId: z.string().uuid().optional(),
  name: promptSafeName,
  sets: z.array(z.object({
    id: optionalId,
    styleId: optionalId,
    setNumber: z.number().int().min(1).max(40),
    // A percentage of 1RM. The band is wide on purpose — this refuses nonsense, it does not
    // second-guess a lifter who programmes above their tested max.
    pct: z.number().min(0).max(300),
    reps: z.number().int().min(0).max(1000),
    restSec: z.number().int().min(0).max(3600),
    useFor1rm: z.boolean(),
  }).strict()),
}).strict()
