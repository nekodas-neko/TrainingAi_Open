'use client'

import { memo } from 'react'
import { ThermometerIcon, TriangleAlertIcon, MoonIcon } from 'lucide-react'

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
  // RV-100: the soft tier was a THIRD amber (`#fbbf24`) beside `#f59e0b` and `--accent-amber`.
  // It uses the token now. The other two keep their literals: red and orange carry the escalation
  // and the repo has no orange token, so converting one of a pair would be worse than neither.
  const borderColor = deloadStrength === 'strong' ? '#ef4444'
    : deloadStrength === 'recommended' ? '#f97316'
    : 'var(--accent-amber)'
  const bgColor = deloadStrength === 'strong' ? 'rgba(239,68,68,0.10)'
    : deloadStrength === 'recommended' ? 'rgba(249,115,22,0.10)'
    : 'color-mix(in oklch, var(--accent-amber) 10%, transparent)'

  let message: string
  if (temperatureAlert) {
    message = 'Body temp elevated — rest or deload recommended'
  } else if (streakBroken) {
    message = `${consecutiveRestDays} rest days — resting today breaks your streak`
  } else {
    const suffix = deloadStrength === 'soft' ? ' — consider a rest soon' : ' — rest or deload recommended today'
    message = `${consecutiveTrainingDays} sessions in a row${suffix}`
  }

  return (
    <div className="px-4 pt-2 pb-1">
      <div
        className="rounded-xl px-3 py-2 flex items-center gap-2"
        style={{ background: bgColor, border: `1px solid ${borderColor}40` }}
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
