// Ingest for the Colmi R09 ring — LEARNING MODE (PS-8).
//
// Deliberately NOT `app/api/hr-ingest`: that route hardcodes `source: 'chest_strap'` and writes
// `oura_heartrate`, which is a scoring input. Everything here lands in the `colmi_*` tables and
// nothing else. See migration 231's header for why ranking a source could not have delivered that.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { formatInTimeZone } from 'date-fns-tz'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { MIN_PLAUSIBLE_BPM, MAX_PLAUSIBLE_BPM } from '@trainingai/shared/validation/plausibility'
import { decodeRawFrames, framesToPayload, type ColmiPayload } from '@/lib/colmi-ble/frames-to-payload'
import type { ColmiReadingKind, ColmiReadingInput, ColmiSleepSegmentInput } from '@/lib/data/postgres/slices/colmi'

const MAX_BODY_BYTES = 512 * 1024

const KINDS = [
  'heart_rate', 'steps', 'calories', 'distance',
  'hrv', 'stress', 'spo2', 'temperature', 'battery',
] as const

// Structural validation only. Value ranges are filtered PER SAMPLE below, never batch-rejected: a
// ring emits an implausible reading during acquisition, and one bad sample must not 400 a whole
// sync (the poison-pill rule — the client would swallow it and drop the batch).
const BodySchema = z.object({
  readings: z.array(z.object({
    kind: z.enum(KINDS),
    at: z.number().int().min(0).max(8_640_000_000_000_000),   // epoch ms; bound is DoS-only
    value: z.number(),
    valueHigh: z.number().nullish(),
  }).strict()).max(5000).optional(),
  sleep: z.array(z.object({
    startedAt: z.number().int().min(0).max(8_640_000_000_000_000),
    endedAt: z.number().int().min(0).max(8_640_000_000_000_000),
    stage: z.number().int().min(0).max(255),
    minutes: z.number().int().min(1).max(24 * 60),
  }).strict()).max(2000).optional(),
  // The archival half. Sent alongside the decoded readings rather than on its own route, so a frame
  // and the samples read out of it arrive in one transaction-shaped request and cannot diverge.
  rawFrames: z.array(z.object({
    channel: z.enum(['v1', 'v2']),
    tag: z.number().int().min(0).max(255).nullish(),
    // 16-byte v1 frames are 32 hex chars; a reassembled v2 frame is larger but bounded by the
    // ring's own payload length field.
    hex: z.string().regex(/^[0-9a-f]{2,4096}$/),
  }).strict()).max(500).optional(),
}).strict()

// A sync can carry the ring's whole buffer, so the past window is generous; the future window is
// not, because a sample ahead of now is a bad clock rather than history. Real sensor data landing
// on future-dated rows is a live incident in this project (Q-56), so this fails closed.
const PAST_TOLERANCE_MS = 30 * 24 * 60 * 60_000
const FUTURE_TOLERANCE_MS = 60_000

/** Per-kind sanity bounds. A sample outside them is dropped, not rejected as a batch. */
const RANGE: Record<ColmiReadingKind, { min: number; max: number }> = {
  heart_rate:  { min: MIN_PLAUSIBLE_BPM, max: MAX_PLAUSIBLE_BPM },
  steps:       { min: 0, max: 20000 },      // per 15-minute bucket
  calories:    { min: 0, max: 2000 },
  distance:    { min: 0, max: 20000 },      // metres per bucket
  hrv:         { min: 1, max: 400 },        // ms
  stress:      { min: 0, max: 100 },
  spo2:        { min: 50, max: 100 },
  temperature: { min: 20, max: 45 },        // °C, skin
  battery:     { min: 0, max: 100 },
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id
  if (!rateLimit(`colmi-ingest:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  // The local day is resolved HERE, from the user's stored timezone — never sent by the client and
  // never derived from the server's clock. Every downstream comparison is "what did each device say
  // on day X", so one writer deciding the day once is what keeps the three devices aligned.
  const tz = session.user.timezone ?? DEFAULT_TZ
  const now = Date.now()
  const inWindow = (at: number) => at >= now - PAST_TOLERANCE_MS && at <= now + FUTURE_TOLERANCE_MS

  // Decode HERE when the client sent bytes and no samples (PS-21 Stage A). One decoder, server-side,
  // is what lets a protocol fix reach data already archived — three of this integration's defects
  // were repaired that way. The client keeps the option of sending decoded readings so a transport
  // that predates this route's decode is not broken by deploying it.
  //
  // `todayStr` is resolved from the user's stored timezone, never sent by the client: it anchors
  // every `daysAgo` the ring reports, so one writer deciding the day is what keeps the ring's
  // relative time and the `local_date` column agreeing.
  const posted = parsed.data.rawFrames ?? []
  const decoded: ColmiPayload | null = posted.length > 0 && !parsed.data.readings && !parsed.data.sleep
    ? framesToPayload(decodeRawFrames(posted), {
        todayStr: formatInTimeZone(new Date(now), tz, 'yyyy-MM-dd'),
        timezone: tz,
      })
    : null

  const inputReadings = decoded?.readings ?? parsed.data.readings ?? []
  const inputSleep = decoded?.sleep ?? parsed.data.sleep ?? []

  const readings: ColmiReadingInput[] = []
  for (const r of inputReadings) {
    if (!inWindow(r.at)) continue
    const range = RANGE[r.kind as ColmiReadingKind]
    if (!range) continue
    if (!Number.isFinite(r.value) || r.value < range.min || r.value > range.max) continue
    const at = new Date(r.at)
    readings.push({
      kind: r.kind as ColmiReadingKind,
      measuredAt: at,
      localDate: formatInTimeZone(at, tz, 'yyyy-MM-dd'),
      value: r.value,
      valueHigh: Number.isFinite(r.valueHigh ?? NaN) ? r.valueHigh : null,
    })
  }

  const sleep: ColmiSleepSegmentInput[] = []
  for (const seg of inputSleep) {
    if (!inWindow(seg.startedAt) || !inWindow(seg.endedAt)) continue
    if (seg.endedAt <= seg.startedAt) continue
    // Restated here rather than left to the Zod schema, because a server-decoded segment never
    // meets it. A junk tail on the sleep frame stored an 8.9-hour night as 19.1 (migration 260),
    // and the decoder fix that stops it is one decoder away from this route — so the bound the
    // client path has always had is applied to both paths at the point of the write.
    if (!Number.isInteger(seg.minutes) || seg.minutes < 1 || seg.minutes > 24 * 60) continue
    if (!Number.isInteger(seg.stage) || seg.stage < 0 || seg.stage > 255) continue
    const startedAt = new Date(seg.startedAt)
    sleep.push({
      // The night belongs to the day it STARTED in, which is what makes a 23:40 bedtime and a
      // 00:20 one land on the same night rather than either side of a midnight.
      localDate: formatInTimeZone(startedAt, tz, 'yyyy-MM-dd'),
      startedAt,
      endedAt: new Date(seg.endedAt),
      stage: seg.stage,
      minutes: seg.minutes,
    })
  }

  const repo = await getRepositoryAsync()
  // Raw frames are written UNFILTERED and unconditionally. Every filter above discards something,
  // and what it discards is exactly what a later decoder fix needs to see.
  const rawFrames = posted.map(f => ({
    channel: f.channel, tag: f.tag ?? null, hex: f.hex,
  }))
  const [storedReadings, storedSleep, storedFrames] = await Promise.all([
    repo.insertColmiReadings(userId, readings),
    repo.insertColmiSleepSegments(userId, sleep),
    repo.insertColmiRawFrames(userId, rawFrames),
  ])

  return NextResponse.json({
    ok: true,
    // `received` vs `stored` is the signal that a re-sync is deduping rather than failing — without
    // both numbers a repeat sync looks identical to a broken one.
    received: { readings: inputReadings.length, sleep: inputSleep.length, frames: posted.length },
    // Says which side read the bytes, so a sync that silently fell back to the client's decode is
    // visible on the card rather than looking identical to a server-decoded one.
    decodedBy: decoded ? 'server' : 'client',
    accepted: { readings: readings.length, sleep: sleep.length },
    stored: { readings: storedReadings, sleep: storedSleep, frames: storedFrames },
  })
}
