// `/api/client-error` bodies (#2913). The web reporters post one event with a message, stack and
// page URL; the native app posts a small batch of scrubbed events, each carrying where it happened
// instead of a stack. Both land in `error_events` with `source: 'client'`.
import { z } from 'zod'

/** The most events one native request may carry; the route's rate limit counts requests. */
export const MAX_CLIENT_ERROR_BATCH = 5

/** A screen or route name the native app sets itself — never user text. */
export const CLIENT_ERROR_SCREEN = /^[A-Za-z][A-Za-z0-9 _:/-]{0,59}$/
/** An `/api/` path with its ids already replaced by `:id`, and no query. */
export const CLIENT_ERROR_API_PATH = /^\/api\/[A-Za-z0-9/_:-]{0,110}$/

// Columns are bounded server-side by truncation, so the web reporters' long stacks still record.
const text = z.string()

export const WebClientErrorSchema = z.object({
  message: text.min(1),
  stack: text.nullish(),
  url: text.nullish(),
}).strict()

export const NativeClientErrorSchema = z.object({
  message: text.min(1).max(500),
  screen: z.string().regex(CLIENT_ERROR_SCREEN),
  apiPath: z.string().regex(CLIENT_ERROR_API_PATH).optional(),
  appVersion: z.string().regex(/^[0-9A-Za-z.+-]{1,32}$/),
  buildCode: z.string().regex(/^[0-9A-Za-z.]{1,16}$/),
  platform: z.enum(['android', 'ios']),
}).strict()
export type NativeClientError = z.infer<typeof NativeClientErrorSchema>

export const NativeClientErrorBatchSchema = z.object({
  events: z.array(NativeClientErrorSchema).min(1).max(MAX_CLIENT_ERROR_BATCH),
}).strict()
