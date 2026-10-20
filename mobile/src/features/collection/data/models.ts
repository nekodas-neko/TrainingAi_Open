import { z } from 'zod';
import type { CollectionState } from '@trainingai/shared/collection/ladder';

const count = z.number().finite().nonnegative();
const catSchema = z.object({
  id: z.string(),
  tier: count,
  name: z.string(),
  born: z.string(),
  from: z.array(z.string()),
});
const stateSchema = z.object({
  stock: z.array(count),
  duplicateDays: count,
  decayEvents: count,
  cats: z.array(catSchema).optional(),
  restless: z.boolean().optional(),
  lastLost: z.object({ name: z.string(), day: z.string() }).nullish(),
  bank: z.number().optional(),
  unitsPerT1: z.number().optional(),
  reached: z.array(z.string().nullable()).optional(),
});
// What the shared replay produces, so a view built from the server's answer and one built by the
// web read the same type.
const collectionState: z.ZodType<CollectionState> = stateSchema;

/**
 * `GET /api/collection`: the four finished ladders (collection rules v2), replayed on the server
 * from all history. Preview replays nothing; the web's two surfaces read the same block.
 */
export const collectionSpec = {
  path: '/api/collection',
  // COLLECTION_TTL in the web: the same five minutes the rewards view keeps.
  ttl: 300_000,
  schema: z.object({
    today: z.string(),
    v2: z.object({
      rulesVersion: z.number(),
      collections: z.object({
        workout: collectionState,
        steps: collectionState,
        health: collectionState,
        cardio: collectionState,
      }),
    }),
  }),
};
export type CollectionResponse = z.infer<typeof collectionSpec.schema>;
export type Collections = CollectionResponse['v2']['collections'];
