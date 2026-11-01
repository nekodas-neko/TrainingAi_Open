// Reading a connected user's data from Oura Cloud (#2859): one document by id (what a webhook names),
// a date range of documents (the backfill), and the heart-rate series.
//
// Every response is checked: a page that is not the spec's `MultiDocumentResponse` / `TimeSeriesResponse`
// shape is an error, and a document inside it that does not match its model is dropped and counted.
// `next_token` is followed until it is null, with a page cap so a server that never stops cannot hold
// a request open forever.
import { z } from 'zod'
import { OURA_API_BASE, OURA_REQUEST_TIMEOUT_MS } from './config'
import { OuraUnavailableError } from './client'
import {
  HeartRateRow, OURA_DOCUMENT_TYPES, RingBatteryRow, parseOuraDocument,
  type OuraDocument, type OuraDocumentType,
} from './documents'

/** The token was refused (401): expired, revoked, or the grant is gone. */
export class OuraUnauthorizedError extends Error {
  constructor() {
    super('Oura refused the access token')
    this.name = 'OuraUnauthorizedError'
  }
}

/** 403: the user's Oura membership lapsed or they did not share this data type. Not worth retrying. */
export class OuraForbiddenError extends Error {
  constructor(readonly path: string) {
    super(`Oura refused access to ${path} (403)`)
    this.name = 'OuraForbiddenError'
  }
}

/**
 * 429: Oura is rate limiting this app. `retryAfterMs` is its `Retry-After` header (seconds or an
 * HTTP date) as a wait from now, or `null` when it sent none we can read. Still an
 * `OuraUnavailableError`, so the webhook answers 503 and Oura retries.
 */
export class OuraRateLimitedError extends OuraUnavailableError {
  constructor(path: string, readonly retryAfterMs: number | null) {
    super(`Oura's ${path} answered 429${retryAfterMs != null ? ` (retry after ${Math.ceil(retryAfterMs / 1000)} s)` : ''}`, 429)
    this.name = 'OuraRateLimitedError'
  }
}

/** A `Retry-After` value as milliseconds from `now`; `null` when absent or unreadable. */
export function parseRetryAfter(raw: string | null, now = Date.now()): number | null {
  if (!raw) return null
  const v = raw.trim()
  if (/^\d+$/.test(v)) return Number(v) * 1000
  const at = Date.parse(v)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

/** No more than this many pages per collection read; at Oura's page sizes it is years of data. */
export const MAX_PAGES = 50

const Page = z.object({ data: z.array(z.unknown()), next_token: z.string().nullable().optional() })

async function getJson(path: string, accessToken: string, query?: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const url = `${OURA_API_BASE}/v2/usercollection/${path}${query ? `?${new URLSearchParams(query)}` : ''}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(OURA_REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    throw new OuraUnavailableError(`Oura could not be reached: ${err instanceof Error ? err.name : 'unknown'}`)
  }
  if (res.status === 401) throw new OuraUnauthorizedError()
  if (res.status === 403) throw new OuraForbiddenError(path.split('/')[0])
  if (res.status === 404) return { status: 404, body: null }
  // The webhook answers 503 and Oura retries; the backfill waits out a short Retry-After, else stops.
  if (res.status === 429) throw new OuraRateLimitedError(path.split('/')[0], parseRetryAfter(res.headers.get('retry-after')))
  if (!res.ok) throw new OuraUnavailableError(`Oura's ${path.split('/')[0]} answered ${res.status}`, res.status)
  const body: unknown = await res.json().catch(() => undefined)
  if (body === undefined) throw new OuraUnavailableError(`Oura's ${path.split('/')[0]} answered with a body that is not JSON`)
  return { status: res.status, body }
}

/**
 * One document by its id, as a webhook names it. `null` when Oura no longer has it (404) or it does
 * not match the spec's model.
 */
export async function fetchOuraDocument(accessToken: string, type: OuraDocumentType, id: string): Promise<OuraDocument | null> {
  const { status, body } = await getJson(`${OURA_DOCUMENT_TYPES[type].path}/${encodeURIComponent(id)}`, accessToken)
  if (status === 404) return null
  return parseOuraDocument(type, body)
}

/**
 * Every page of a collection. A 404 ends the read with what it has, and `complete: false`: the list
 * was cut short, so it says nothing about what Oura no longer has (#3153).
 */
async function readPages(path: string, accessToken: string, query: Record<string, string>): Promise<{ items: unknown[]; complete: boolean }> {
  const items: unknown[] = []
  let next: string | null | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const { status, body } = await getJson(path, accessToken, next ? { ...query, next_token: next } : query)
    if (status === 404) return { items, complete: false }
    const parsed = Page.safeParse(body)
    if (!parsed.success) throw new OuraUnavailableError(`Oura's ${path} page had an unexpected shape`)
    items.push(...parsed.data.data)
    next = parsed.data.next_token
    if (!next) return { items, complete: true }
  }
  throw new OuraUnavailableError(`Oura's ${path} returned more than ${MAX_PAGES} pages`)
}

/**
 * Every document of `type` whose `day` is in [startDate, endDate] (inclusive, `YYYY-MM-DD`).
 * `dropped` counts documents that did not match the spec's model. `complete` is false when Oura
 * answered 404 on some page, so the list may be short (#3153).
 */
export async function fetchOuraDocuments(
  accessToken: string, type: OuraDocumentType, startDate: string, endDate: string,
): Promise<{ docs: OuraDocument[]; dropped: number; complete: boolean }> {
  const { items: raw, complete } = await readPages(OURA_DOCUMENT_TYPES[type].path, accessToken, { start_date: startDate, end_date: endDate })
  const docs: OuraDocument[] = []
  let dropped = 0
  for (const r of raw) {
    const doc = parseOuraDocument(type, r)
    if (doc) docs.push(doc)
    else dropped++
  }
  return { docs, dropped, complete }
}

/** The heart-rate series between two instants. */
export async function fetchOuraHeartRate(
  accessToken: string, start: Date, end: Date,
): Promise<{ rows: HeartRateRow[]; dropped: number }> {
  const { items: raw } = await readPages('heartrate', accessToken, { start_datetime: start.toISOString(), end_datetime: end.toISOString() })
  const rows: HeartRateRow[] = []
  let dropped = 0
  for (const r of raw) {
    const parsed = HeartRateRow.safeParse(r)
    if (parsed.success) rows.push(parsed.data)
    else dropped++
  }
  return { rows, dropped }
}

/** The ring's battery readings between two instants (`ring_battery_level`, #3069). */
export async function fetchOuraRingBattery(
  accessToken: string, start: Date, end: Date,
): Promise<{ rows: RingBatteryRow[]; dropped: number }> {
  const { items: raw } = await readPages('ring_battery_level', accessToken, { start_datetime: start.toISOString(), end_datetime: end.toISOString() })
  const rows: RingBatteryRow[] = []
  let dropped = 0
  for (const r of raw) {
    const parsed = RingBatteryRow.safeParse(r)
    if (parsed.success) rows.push(parsed.data)
    else dropped++
  }
  return { rows, dropped }
}
