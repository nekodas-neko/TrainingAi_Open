"use client"

import { Gauge, ScrollText, Sparkles } from 'lucide-react'
import { useTransitionRouter } from '@/lib/view-transition'
import { MoreSubScreen } from '@/components/more/sub-screen'
import { MoreRow, MoreRowGroup } from '@/components/more/more-row'
import TimeAuditCard from '@/components/admin/time-audit-card'
import ProgramExportCard from '@/components/admin/program-export-card'
import ExerciseUnitFix from '@/components/admin/exercise-unit-fix'
import SetHrBackfillCard from '@/components/admin/set-hr-backfill-card'
import WorkoutHrBackfillCard from '@/components/admin/workout-hr-backfill-card'
import ModelAssetsCard from '@/components/admin/model-assets-card'

/** Settings → Developer. App diagnostics — the error log, AI usage, day review, and the one-off
 *  maintenance cards. **Device consoles are NOT here (Q-531)**: they live under `/admin` → Devices,
 *  because a drain or a re-sync is destructive in the wrong hands and access control outranks the
 *  taxonomy that put them here (Q-234). Do not re-add a device row to this screen. */
export function DeveloperContent() {
  const router = useTransitionRouter()
  return (
    <MoreSubScreen title="Developer">
      {/* Q-531: the three device consoles used to be listed here as well. They are routed under
          `/admin` and always were, so listing them from two places is what made the drain → verify
          flow feel spread out — the owner went to the admin console and found nothing. One home:
          `/admin` → Devices. What stays here is the diagnostics that are genuinely about the app
          rather than about a device. */}
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
