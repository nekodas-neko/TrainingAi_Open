"use client"

import { Gauge, ScrollText, Sparkles, Wrench } from 'lucide-react'
import { useTransitionRouter } from '@/lib/view-transition'
import { MoreSubScreen } from '@/components/more/sub-screen'
import { MoreRow, MoreRowGroup } from '@/components/more/more-row'
import { ConsoleSection } from '@/components/admin/console-section'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
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

      {/* #2250 — the owner's keep/hide call per card (2026-10-05), from the inventory in
          `docs/admin-control-inventory.md` §A. Everything stays visible except the unit fix, which
          is folded rather than deleted: a repair that is gone cannot be used when it is needed. */}
      <ConsoleSection title="Checks" when="Read what the app is doing. Model assets is the only sign that production is loading its models from storage rather than the repo copy.">
        <ModelAssetsCard />
        <TimeAuditCard />
        <ProgramExportCard />
      </ConsoleSection>

      <ConsoleSection title="Heart-rate backfills" when="When a workout ended without its recap being opened, which is the only thing that fills these. Safe to re-run.">
        <SetHrBackfillCard />
        <WorkoutHrBackfillCard />
      </ConsoleSection>

      <ConsoleSection title="One-off repairs" when="Corrections applied once to old logs, kept folded away in case one is needed again.">
        <CollapsibleSection title="Fix lbs logged as kg" icon={<Wrench className="h-4 w-4" />}>
          <ExerciseUnitFix />
        </CollapsibleSection>
      </ConsoleSection>
    </MoreSubScreen>
  )
}
