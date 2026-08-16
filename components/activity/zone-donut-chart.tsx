'use client'

import { useMemo } from 'react'
import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip, type ChartData } from 'chart.js'
import { computeHrZones } from '@trainingai/shared/health/hr-zones'
import { zoneBreakdownFromReadings, type HrReading } from '@trainingai/shared/health/zone-minutes'

ChartJS.register(ArcElement, Tooltip)

interface Props {
  readings: { timestamp: string; bpm: number }[]
  profile: { maxHr: number; restingHr: number } | null
}

export function ZoneDonutChart({ readings, profile }: Props) {
  const breakdown = useMemo(() => {
    if (!profile || readings.length < 2) return null
    const zones = computeHrZones(profile)
    const hr: HrReading[] = readings.map(r => ({ timestamp: new Date(r.timestamp).getTime(), bpm: r.bpm }))
    return zoneBreakdownFromReadings(hr, zones)
  }, [readings, profile])

  if (!breakdown || breakdown.totalSec <= 0) return null

  const nonZeroZones = breakdown.zones.filter(z => z.seconds > 0)
  const chartData: ChartData<'doughnut'> = {
    labels: nonZeroZones.map(z => `Z${z.id} ${z.name}`),
    datasets: [{
      data: nonZeroZones.map(z => z.seconds),
      backgroundColor: nonZeroZones.map(z => z.color),
      borderWidth: 0,
    }],
  }

  return (
    <div className="mx-auto h-28 w-28">
      <Doughnut
        data={chartData}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          cutout: '65%',
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
        }}
      />
    </div>
  )
}
