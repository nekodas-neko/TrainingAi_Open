// Shared paired-gate-window feed. Single pipeline off the plugin's frame
// listeners; consumers: the step orchestrator (counting trigger) and passive
// activity detection (GPS trigger). First subscriber attaches the plugin
// listeners, last unsubscribe detaches them.
import { getOuraBle, type OuraFrameEvent, type OuraBleStatus } from './plugin'
import { historyEventFromHex, hexToBytes } from './decode'
import { pairStepFeatures, type StepFeatureFrame } from './step-features'
import { isWalkingWindow } from '@trainingai/shared/health/step-estimate'

export type GateFeedEvent =
  | { type: 'window'; ds: number; columns: number[]; walking: boolean }
  | { type: 'disconnect' }

type Listener = (ev: GateFeedEvent) => void

const GATE_FRAME_TAGS = new Set([0x7e, 0x7f])
const GATE_BUFFER_CAP = 40

let listeners: Listener[] = []
let handles: Array<{ remove: () => Promise<void> }> = []
const gateBuffer: StepFeatureFrame[] = []
let lastProcessedGateDs = -Infinity
let attaching: Promise<void> | null = null

function emit(ev: GateFeedEvent) { for (const l of listeners) l(ev) }

/** Exported for direct exercise in tests — the real path is plugin listeners via attach(). */
export function onFrames(events: OuraFrameEvent[]) {
  let sawGate = false
  for (const f of events) {
    if (!GATE_FRAME_TAGS.has(f.tag)) continue
    const ev = historyEventFromHex(f.hex)
    if (!ev) continue
    gateBuffer.push({ ds: ev.timestampDs, tag: ev.tag, body: hexToBytes(ev.bodyHex) })
    if (gateBuffer.length > GATE_BUFFER_CAP) gateBuffer.splice(0, gateBuffer.length - GATE_BUFFER_CAP)
    sawGate = true
  }
  if (!sawGate) return
  for (const p of pairStepFeatures(gateBuffer)) {
    if (p.ds <= lastProcessedGateDs) continue
    lastProcessedGateDs = p.ds
    emit({ type: 'window', ds: p.ds, columns: p.columns, walking: isWalkingWindow(p.columns) })
  }
}

/** Exported for direct exercise in tests. */
export function onStatus(status: OuraBleStatus) {
  if (status.state === 'disconnected' || status.state === 'closed' || status.state === 'stopped') {
    emit({ type: 'disconnect' })
  }
}

async function attach(): Promise<void> {
  const ble = await getOuraBle()
  if (!ble) return
  handles.push(await ble.plugin.addListener('ouraFrame', (f) => onFrames([f])))
  handles.push(await ble.plugin.addListener('ouraFrames', ({ frames }) => onFrames(frames)))
  handles.push(await ble.plugin.addListener('ouraStatus', onStatus))
}

export async function subscribeGateFeed(cb: Listener): Promise<() => void> {
  listeners.push(cb)
  if (handles.length === 0 && !attaching) attaching = attach().finally(() => { attaching = null })
  if (attaching) await attaching
  return () => {
    listeners = listeners.filter((l) => l !== cb)
    if (listeners.length === 0) {
      for (const h of handles) void h.remove().catch(() => {})
      handles = []
    }
  }
}
