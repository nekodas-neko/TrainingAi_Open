import { z } from 'zod';

/** Whether today is a training day, from the next-session answer: undefined when it cannot be known. */
export const nextSessionSpec = {
  path: '/api/next-session',
  ttl: 300000,
  schema: z
    .object({
      isRestDay: z.boolean(),
      session: z.object({ id: z.string() }).passthrough().nullish(),
    })
    .passthrough(),
};
export function knownTrainingDay(
  data: z.infer<typeof nextSessionSpec.schema> | null | undefined,
): boolean | undefined {
  if (!data) return undefined;
  return data.isRestDay ? false : data.session ? true : undefined;
}
