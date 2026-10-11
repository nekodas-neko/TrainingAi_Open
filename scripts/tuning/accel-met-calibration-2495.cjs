#!/usr/bin/env node
/**
 * Issue 2495 — how well per-minute MET derived from the ring's raw accelerometer matches the ring's
 * own MET, on minutes where both exist. READ-ONLY. Nothing here writes, and nothing wires the
 * derivation into the input cascade: this report comes first.
 *
 *   node scripts/tuning/accel-met-calibration-2495.cjs --pull [days]   # production via /api/admin/db-query
 *                                                                       # (CLAUDE_DB_QUERY_SECRET; default 60 days)
 *   node scripts/tuning/accel-met-calibration-2495.cjs --report        # pair, fit, score, print
 *
 * What it reads, all through the owner-scoped `claude_ro` views:
 *   · `oura_accel_chunks`   — the raw magnitude chunks continuous capture posts (wall-clock starts);
 *   · `oura_raw_samples` + `oura_raw_packed`, tag 0x50 — the ring's activity frames, whose `met` bins
 *     become `device_met` through the shipped `metGridFromDaytimeSamples`, exactly as
 *     `getOuraDaytimeSignals` builds it;
 *   · `oura_ble_clock_anchors` — reduced to per-epoch offsets by the same SQL `getOuraClockOffsets` runs.
 *
 * The derivation, the decoders, the frame unpacker, the clock conversion and the calibration are all
 * BUNDLED from the shipped modules (`accel-met-calibration-entry.ts`), never copied.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const DIR = process.env.ACCEL_MET_DIR || '/tmp/accel-met-calibration'
const API = 'https://trainingai-production.up.railway.app/api/admin/db-query'
const ROOT = path.resolve(__dirname, '../..')

function query(sql) {
  const secret = process.env.CLAUDE_DB_QUERY_SECRET
  if (!secret) throw new Error('CLAUDE_DB_QUERY_SECRET is not set')
  const res = execFileSync('curl', [
    '-sS', '-X', 'POST', API,
    '-H', `Authorization: Bearer ${secret}`,
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify({ sql }),
  ], { maxBuffer: 1 << 28, encoding: 'utf8' })
  const parsed = JSON.parse(res)
  if (parsed.error) throw new Error(`db-query: ${parsed.error}`)
  return parsed
}

/** Keyset-paged read: the endpoint caps a result at 1,000 rows and 5 MB, so every table that can
 *  exceed either is read in pages and a truncated page is never mistaken for the end. */
function paged(name, sqlFor, keyOf, pageSize) {
  const rows = []
  let after = null
  for (;;) {
    const r = query(sqlFor(after, pageSize))
    rows.push(...r.rows)
    if (r.rows.length === 0 || (!r.truncated && r.rows.length < pageSize)) break
    after = keyOf(r.rows[r.rows.length - 1])
    process.stdout.write(`\r${name}: ${rows.length}`)
  }
  process.stdout.write(`\r${name}: ${rows.length}\n`)
  return rows
}

function save(name, rows) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify({ rows }))
}

function pull(days) {
  const read = name => JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8')).rows
  const d = Number(days) > 0 ? Math.floor(Number(days)) : 60
  save('user', query(`SELECT timezone FROM claude_ro.users`).rows)
  // getOuraClockOffsets, verbatim apart from the view and the literal percentile.
  save('clock', query(`
    WITH lags AS (
      SELECT epoch, floor(extract(epoch FROM anchor_utc) * 1000) - anchor_ds * 100 AS lag_ms
      FROM claude_ro.oura_ble_clock_anchors
    ),
    per_epoch AS (SELECT epoch, floor(count(*) * 0.1::float8)::int AS idx FROM lags GROUP BY epoch)
    SELECT p.epoch, (SELECT l.lag_ms::bigint FROM lags l WHERE l.epoch = p.epoch ORDER BY l.lag_ms OFFSET p.idx LIMIT 1) AS offset_ms
    FROM per_epoch p`).rows)
  const chunks = paged('accel chunks',
    (after, n) => `SELECT id, (extract(epoch FROM started_at) * 1000)::bigint AS started_ms, sample_rate, magnitudes
      FROM claude_ro.oura_accel_chunks
      WHERE started_at > now() - interval '${d} days' ${after != null ? `AND id > ${Number(after)}` : ''}
      ORDER BY id LIMIT ${n}`,
    row => row.id, 60)
  save('chunks', chunks)
  if (chunks.length === 0) { console.log('No accelerometer chunks in the window — nothing to calibrate.'); return }
  const span = chunks.reduce((a, c) => ({ min: Math.min(a.min, Number(c.started_ms)), max: Math.max(a.max, Number(c.started_ms)) }), { min: Infinity, max: -Infinity })
  const minMs = span.min - 86_400_000
  const maxMs = span.max + 86_400_000
  save('span', [{ minMs, maxMs }])
  // The window in ring deciseconds, by every epoch's offset (the inverse of `dsToMs`: ms = ds × 100 +
  // offset). Frames are then read by ds, as `getOuraDaytimeSignals` reads them, and `--report`
  // converts each frame back with the bundled `dsToMs`.
  const offsets = read('clock').map(r => r.offset_ms).filter(o => o != null).map(Number)
  if (offsets.length === 0) { console.log('No clock anchors — the ring\'s frames cannot be placed in time.'); return }
  const dsLo = Math.floor(Math.min(...offsets.map(o => (minMs - o) / 100)))
  const dsHi = Math.ceil(Math.max(...offsets.map(o => (maxMs - o) / 100)))
  save('hot', paged('0x50 hot frames',
    (after, n) => `SELECT id, ring_timestamp_ds AS ds, body_hex, decoded
      FROM claude_ro.oura_raw_samples
      WHERE tag = 80 AND ring_timestamp_ds BETWEEN ${dsLo} AND ${dsHi} ${after != null ? `AND id > ${Number(after)}` : ''}
      ORDER BY id LIMIT ${n}`,
    row => row.id, 1000))
  save('packed', paged('0x50 packed buckets',
    (after, n) => `SELECT ds_bucket, encode(blob, 'base64') AS b64
      FROM claude_ro.oura_raw_packed
      WHERE tag = 80 AND max_ds >= ${dsLo} AND min_ds <= ${dsHi} ${after != null ? `AND ds_bucket > ${Number(after)}` : ''}
      ORDER BY ds_bucket LIMIT ${n}`,
    row => row.ds_bucket, 200))
  console.log(`pulled into ${DIR}`)
}

function bundle() {
  const file = path.join(ROOT, 'node_modules/.cache/accel-met-calibration/entry.cjs')
  const win = process.platform === 'win32'
  execFileSync(win ? 'npx.cmd' : 'npx', ['esbuild', path.join(__dirname, 'accel-met-calibration-entry.ts'),
    '--bundle', '--format=cjs', '--platform=node', '--tsconfig=tsconfig.json', '--log-level=error',
    '--external:onnxruntime-node', '--external:onnxruntime-web', '--external:pg-native', `--outfile=${file}`],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], shell: win })
  return require(file)
}

const f2 = v => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2))

function report() {
  const read = name => JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8')).rows
  const lib = bundle()
  const tz = read('user')[0]?.timezone || 'Australia/Brisbane'
  const offsets = new Map(read('clock').map(r => [Number(r.epoch), r.offset_ms == null ? null : Number(r.offset_ms)]))
  const clock = { epoch: offsets.size ? Math.max(...offsets.keys()) : null, offsets }
  const { minMs, maxMs } = read('span')[0] ?? { minMs: 0, maxMs: 0 }

  // The ring's MET, as getOuraDaytimeSignals builds it: both tiers, deduped where they overlap.
  const seen = new Set()
  const met = []
  const take = (ds, bodyHex, decoded) => {
    const key = `${ds}:${bodyHex}`
    if (bodyHex && seen.has(key)) return
    if (bodyHex) seen.add(key)
    const tsMs = lib.dsToMs(Number(ds), clock)
    if (tsMs == null || tsMs < minMs || tsMs > maxMs) return
    const dec = decoded ?? (bodyHex ? lib.decodeEventBody(0x50, lib.hexToBytes(bodyHex)) : null)
    if (!dec) return
    for (const v of lib.numericField(dec, 'met')) met.push({ tsMs, value: v })
  }
  for (const h of read('hot')) take(h.ds, h.body_hex, h.decoded)
  for (const p of read('packed')) {
    for (const fr of lib.unpackFrames(Buffer.from(p.b64, 'base64'))) take(fr.ds, lib.bodyToHex(fr.body), null)
  }
  met.sort((a, b) => a.tsMs - b.tsMs)
  const grid = lib.metGridFromDaytimeSamples(met)
  const device = new Map()
  grid.metsPerMinute.forEach((v, i) => { if (v != null) device.set(grid.startTimestampMs + i * 60_000, v) })

  const chunks = read('chunks').map(c => ({ startedAtMs: Number(c.started_ms), sampleRate: Number(c.sample_rate), magnitudes: c.magnitudes.map(Number) }))
  const minutes = lib.accelMinuteIntensity(chunks)
  const pairs = lib.pairWithDeviceMet(minutes, device)
  const dayOf = slot => new Date(slot).toLocaleDateString('en-CA', { timeZone: tz })
  const r = lib.accelMetCalibration(pairs, dayOf)

  console.log(`Accelerometer chunks: ${chunks.length} · minutes derived: ${minutes.length} · ring MET minutes: ${device.size}`)
  console.log(`Paired minutes (both exist): ${pairs.length} across ${r.days} day(s)`)
  if (!r.model) { console.log('Too few paired minutes to fit — no calibration possible yet.'); return }
  console.log(`Fitted on all pairs: MET = max(1, ${r.model.intercept.toFixed(3)} + ${r.model.slope.toFixed(3)} × intensity)`)
  console.log(`Held-out (leave one day out): n ${r.heldOut.n} · MAE ${f2(r.heldOut.mae)} · RMSE ${f2(r.heldOut.rmse)} · bias ${f2(r.heldOut.bias)} · r ${f2(r.heldOut.r)}`)
  console.log(`Baseline (predict the mean):  MAE ${f2(r.baseline.mae)} · RMSE ${f2(r.baseline.rmse)}`)
  console.log('By ring-MET band (held out):')
  for (const b of r.byBand) console.log(`  ${b.label.padEnd(16)} n ${String(b.n).padStart(6)} · MAE ${f2(b.mae)} · bias ${f2(b.bias)}`)
}

const [, , mode, arg] = process.argv
if (mode === '--pull') pull(arg)
else if (mode === '--report') report()
else { console.error('usage: --pull [days] | --report'); process.exit(1) }
