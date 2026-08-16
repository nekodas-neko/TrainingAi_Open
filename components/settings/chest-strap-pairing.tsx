// components/settings/chest-strap-pairing.tsx
'use client'
import { useEffect, useState } from 'react'
import { HeartPulseIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getPairedStrap, setPairedStrap, type PairedStrap } from '@/lib/live-hr/paired-strap'
import { HR_SERVICE, getChestStrapLinkStatus, type StrapLinkStatus } from '@/lib/live-hr/chest-strap-source'
import { strapLinkLabel } from '@/lib/live-hr/strap-link-label'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import { useRefreshOnTabShow } from '@/components/shell/tab-visibility'

const BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb'
const BATTERY_LEVEL = '00002a19-0000-1000-8000-00805f9b34fb'
const DEVICE_INFO_SERVICE = '0000180a-0000-1000-8000-00805f9b34fb'
const FIRMWARE_REVISION = '00002a26-0000-1000-8000-00805f9b34fb'

export function ChestStrapPairing() {
  const [paired, setPaired] = useState<PairedStrap | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [battery, setBattery] = useState<number | null>(null)
  const [firmware, setFirmware] = useState<string | null>(null)
  const [link, setLink] = useState<StrapLinkStatus>({ gattConnected: false, worn: true, active: false, state: 'stopped' })
  const [reconnecting, setReconnecting] = useState(false)

  useEffect(() => { setPaired(getPairedStrap()) }, [])

  // Re-showing the tab is a deliberate "is my strap on?" check — re-arm the connection then, so
  // the card reflects a strap put on since the last look instead of needing an app restart.
  useRefreshOnTabShow(() => {
    setPaired(getPairedStrap())
    getLiveHrManager().retryAmbient().catch(() => {})
  })

  // Live link readout (raw GATT truth, 1 Hz while the card is mounted) — so "paired"
  // never reads as "permanently connected". The app only holds a BLE link while
  // live-HR is running (workouts / Measure now); outside that this shows Not connected.
  useEffect(() => {
    if (!paired) return
    setLink(getChestStrapLinkStatus())
    const t = setInterval(() => setLink(getChestStrapLinkStatus()), 1000)
    return () => clearInterval(t)
  }, [paired])

  const linkLabel = strapLinkLabel(link)

  // The native service stops itself after exhausting its backoff ladder (~4 min), on the
  // reasoning that an unreachable strap usually just isn't being worn. Before this, the only way
  // to get it back was restarting the app.
  async function reconnect() {
    setReconnecting(true)
    setError(null)
    try {
      const { getPolarBle } = await import('@/lib/polar-ble/plugin')
      const native = await getPolarBle()
      if (!native) { setError('Strap connection is only available in the app.'); return }
      // Through the manager rather than the plugin directly: a strap paired after app launch has
      // no live relay wired up yet, and restarting the service alone would connect it without the
      // app ever seeing a beat.
      const mgr = getLiveHrManager()
      await mgr.startAmbient()
      await mgr.retryAmbient()
      setLink(getChestStrapLinkStatus())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the strap connection.')
    } finally {
      setReconnecting(false)
    }
  }

  async function scanAndPair() {
    setError(null); setScanning(true)
    try {
      const { Capacitor } = await import('@capacitor/core')
      if (!Capacitor.isNativePlatform()) { setError('Strap pairing is only available in the app.'); return }
      const { BleClient } = await import('@capacitor-community/bluetooth-le')
      await BleClient.initialize()
      // OS picker filtered to Heart Rate Service devices — the H10 advertises
      // 0x180D as "Polar H10 XXXXXXXX". No bonding: connect directly, never
      // system-pair (Polar guidance; a system bond interferes with app connects).
      const device = await BleClient.requestDevice({ services: [HR_SERVICE] })
      const next = { deviceId: device.deviceId, name: device.name ?? 'HR strap' }
      setPairedStrap(next); setPaired(next)
      // The ambient provider only mounts once, so without this a freshly-paired strap sat idle
      // until the next app start.
      getLiveHrManager().startAmbient().catch(() => {})
      // Best-effort battery + firmware readout (CR2025 coin cell — a dying cell
      // presents as flaky connections, so surface the %; the FW revision is our
      // record for PMD re-validation if the owner ever updates via Polar Flow).
      try {
        await BleClient.connect(device.deviceId)
        const batt = await BleClient.read(device.deviceId, BATTERY_SERVICE, BATTERY_LEVEL)
        setBattery(new Uint8Array(batt.buffer)[0] ?? null)
        const fw = await BleClient.read(device.deviceId, DEVICE_INFO_SERVICE, FIRMWARE_REVISION)
        setFirmware(new TextDecoder().decode(fw.buffer).replace(/\0+$/, ''))
        await BleClient.disconnect(device.deviceId)
      } catch { /* readout is cosmetic — pairing already succeeded */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pairing failed or cancelled.')
    } finally {
      setScanning(false)
    }
  }

  function forget() {
    setPairedStrap(null); setPaired(null); setBattery(null); setFirmware(null)
    getLiveHrManager().stopAmbient().catch(() => {})
  }

  return (
    <div className="rounded-2xl bg-muted/40 border border-border p-4 space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <HeartPulseIcon className="h-3.5 w-3.5" /> Heart-rate strap
      </p>
      {paired ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm">{paired.name}</span>
            <div className="flex items-center gap-2">
              {!link.gattConnected && (
                <Button variant="outline" size="sm" onClick={reconnect} disabled={reconnecting}>
                  {reconnecting ? 'Connecting…' : 'Connect'}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={forget}>Forget</Button>
            </div>
          </div>
          <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: link.gattConnected ? 'var(--color-brand)' : 'var(--color-muted-foreground)' }}
              aria-hidden
            />
            {linkLabel}
          </p>
          {(battery !== null || firmware) && (
            <p className="text-[10px] text-muted-foreground">
              {battery !== null ? `Battery ${battery}%` : ''}
              {battery !== null && firmware ? ' · ' : ''}
              {firmware ? `Firmware ${firmware}` : ''}
            </p>
          )}
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={scanAndPair} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Pair a heart-rate strap'}
        </Button>
      )}
      <p className="text-[10px] text-muted-foreground">
        While the strap is worn and connected it becomes the heart-rate source during
        workouts; the ring takes over automatically whenever it isn&apos;t.
      </p>
      {/* A-9: sole failure surface for pairing — was near-invisible in light theme. */}
      {error && <p className="text-[10px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
