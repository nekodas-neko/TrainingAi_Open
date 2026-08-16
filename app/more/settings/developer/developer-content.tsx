"use client"

import { Bluetooth, ClipboardList, Footprints, Gauge, ScrollText, Sparkles } from 'lucide-react'
import { useTransitionRouter } from '@/lib/view-transition'
import { MoreSubScreen } from '@/components/more/sub-screen'
import { MoreRow, MoreRowGroup } from '@/components/more/more-row'
import TimeAuditCard from '@/components/admin/time-audit-card'
import ProgramExportCard from '@/components/admin/program-export-card'
import ExerciseUnitFix from '@/components/admin/exercise-unit-fix'
import SetHrBackfillCard from '@/components/admin/set-hr-backfill-card'
import WorkoutHrBackfillCard from '@/components/admin/workout-hr-backfill-card'
import ModelAssetsCard from '@/components/admin/model-assets-card'

/** Settings → Developer. These are debug tools for the owner's own device, used far more often than
 *  user administration, and they used to be the deepest-buried things in the app: a button, inside
 *  a tab, inside a console, reachable only from the bottom of the More scroll (Q-234). */
export function DeveloperContent() {
  const router = useTransitionRouter()
  return (
    <MoreSubScreen title="Developer">
      <MoreRowGroup label="Device consoles">
        <MoreRow icon={Bluetooth} label="Oura BLE debug" onClick={() => router.push('/admin/oura-ble')} />
        <MoreRow icon={Footprints} label="Cadence calibration" onClick={() => router.push('/admin/cadence')} />
        <MoreRow icon={ClipboardList} label="Device data capture" onClick={() => router.push('/admin/data-capture')} />
      </MoreRowGroup>

      <MoreRowGroup label="Diagnostics">
        <MoreRow icon={ScrollText} label="Error log" onClick={() => router.push('/more/settings/developer/errors')} />
        <MoreRow icon={Sparkles} label="AI usage" onClick={() => router.push('/more/settings/developer/ai-usage')} />
        <MoreRow icon={Gauge} label="Day review" onClick={() => router.push('/more/settings/developer/day-review')} />
      </MoreRowGroup>

      <TimeAuditCard />
      <ProgramExportCard />
      <ExerciseUnitFix />
      <SetHrBackfillCard />
      <WorkoutHrBackfillCard />
      <ModelAssetsCard />
    </MoreSubScreen>
  )
}
