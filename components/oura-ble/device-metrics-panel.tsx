"use client";
import { useEffect, useState } from "react";
import type { DeviceMetricsResponse } from "@/app/api/oura-ble/device-metrics/route";
import { Sparkline } from "@/components/ui/sparkline";

// Admin diagnostic: three BLE-derived device metrics (daytime HRV, intraday skin temp, ring uptime)
// computed on-read from stored raw samples. Oura shows none of these three intraday curves.
const DAY_DOMAIN: [number, number] = [0, 86_400]; // seconds since local midnight — a real window renders with visible dead space either side

export function DeviceMetricsPanel() {
  const [data, setData] = useState<DeviceMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/oura-ble/device-metrics?days=3")
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch(e => setError(String(e)));
  }, []);
  if (error) return <div className="text-xs text-red-500">Device metrics: {error}</div>;
  if (!data) return <div className="text-xs text-muted-foreground">Loading device metrics…</div>;
  return (
    <div className="rounded-xl border border-border p-3 text-xs space-y-3">
      <h3 className="font-semibold uppercase tracking-widest text-muted-foreground">Device metrics (BLE-derived)</h3>
      {data.days.length === 0 && <p className="text-muted-foreground">No samples in the last 3 days.</p>}
      {data.days.map(d => (
        <div key={d.date} className="space-y-1">
          <p className="font-mono">{d.date}</p>
          <p className="text-muted-foreground">
            Uptime {d.completeness.pct}% · longest gap {d.completeness.longestGapMin}m · last sample {d.completeness.lastSampleAgeMin}m ago
          </p>
          <div className="flex items-center gap-2">
            <span className="w-24 text-muted-foreground">Daytime HRV</span>
            {d.daytimeHrv.length ? <Sparkline values={d.daytimeHrv.map(p => p.rmssd)} times={d.daytimeHrv.map(p => p.tSec)} timeDomain={DAY_DOMAIN} /> : <span className="text-muted-foreground">—</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-24 text-muted-foreground">Intraday temp</span>
            {d.intradayTemp.length ? <Sparkline values={d.intradayTemp.map(p => p.tempC)} times={d.intradayTemp.map(p => p.tSec)} timeDomain={DAY_DOMAIN} /> : <span className="text-muted-foreground">—</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-24 text-muted-foreground">Intraday SpO₂</span>
            {d.intradaySpo2.length ? <Sparkline values={d.intradaySpo2.map(p => p.spo2)} times={d.intradaySpo2.map(p => p.tSec)} timeDomain={DAY_DOMAIN} /> : <span className="text-muted-foreground">—</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
