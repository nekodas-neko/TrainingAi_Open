'use client'

import { memo } from 'react'
import { ThermometerIcon, TriangleAlertIcon, MoonIcon } from 'lucide-react'
import { deloadBannerMessage } from '@trainingai/shared/ai-periodization/deload-reasons'

interface DeloadBannerProps {
  consecutiveTrainingDays: number
  deloadStrength: 'soft' | 'recommended' | 'strong'
  temperatureAlert: boolean
  consecutiveRestDays: number
  streakBroken: boolean
}

export const DeloadBanner = memo(function DeloadBanner({
  consecutiveTrainingDays,
  deloadStrength,
  temperatureAlert,
  consecutiveRestDays,
  streakBroken,
}: DeloadBannerProps) {
  // Red and amber read the accent tokens; orange keeps its literal because the repo has no orange
  // token. The border is its own colour rather than `${borderColor}40`: a hex alpha appended to a
  // `var()` is invalid CSS and drops the whole declaration, which left the soft tier borderless.
  const borderColor = deloadStrength === 'strong' ? 'var(--destructive)'
    : deloadStrength === 'recommended' ? '#f97316'
    : 'var(--accent-amber)'
  const bgColor = deloadStrength === 'strong' ? 'color-mix(in oklch, var(--destructive) 10%, transparent)'
    : deloadStrength === 'recommended' ? 'rgba(249,115,22,0.10)'
    : 'color-mix(in oklch, var(--accent-amber) 10%, transparent)'
  const edgeColor = deloadStrength === 'strong' ? 'color-mix(in oklch, var(--destructive) 25%, transparent)'
    : deloadStrength === 'recommended' ? '#f9731640'
    : 'color-mix(in oklch, var(--accent-amber) 25%, transparent)'

  const message = deloadBannerMessage({ consecutiveTrainingDays, deloadStrength, temperatureAlert, consecutiveRestDays, streakBroken })

  return (
    <div className="px-4 pt-2 pb-1">
      <div
        className="rounded-xl px-3 py-2 flex items-center gap-2"
        style={{ background: bgColor, border: `1px solid ${edgeColor}` }}
      >
        <span className="leading-none flex-none">
          {temperatureAlert
            ? <ThermometerIcon className="w-4 h-4" style={{ color: borderColor }} />
            : deloadStrength === 'strong'
              ? <TriangleAlertIcon className="w-4 h-4" style={{ color: borderColor }} />
              : <MoonIcon className="w-4 h-4" style={{ color: borderColor }} />}
        </span>
        <p className="text-xs font-semibold leading-snug flex-1 min-w-0" style={{ color: borderColor }}>
          {message}
        </p>
      </div>
    </div>
  )
})
