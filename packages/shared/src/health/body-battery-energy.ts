import { bodyBatteryLabelFor, type BodyBatteryLabel } from './body-battery-band'
import { BODY_BATTERY_PROVISIONAL_SUFFIX, bodyBatteryAnchorSuffix } from './body-battery-copy'

// The number on Home's Energy hero (#2989), derived from the `/api/body-battery` payload. No
// calculation of Body Battery's own lives here: this only decides which of its figures the hero
// draws, so the app that shows it and the tests that pin it read one rule.

/** The slice of the `/api/body-battery` payload the hero reads. The app's parsed payload fits it. */
export type BodyBatteryEnergyInput = {
  hasData: boolean
  current: number
  anchor: number
  anchorSource: Parameters<typeof bodyBatteryAnchorSuffix>[0]
  anchorProvisional: boolean
  series: readonly { v: number }[]
  confidence?: { sufficient: boolean } | null
}

export type EnergyHero =
  | { hasData: false }
  | {
      hasData: true
      /** The number the hero draws. */
      level: number
      /** Where the day opened, kept as the notch on the gauge. */
      morning: number
      drained: number
      label: BodyBatteryLabel
      /** "woke at 76", plus how far it has fallen. */
      sub: string
      /** Where the morning figure came from, for the line beside the title. */
      origin: string
      limited: boolean
    }

const clamp = (value: number) => Math.max(0, Math.min(100, value))

/**
 * The figure the hero draws before it is held under the morning mark.
 *
 * THE ONE LINE TO CHANGE if the owner picks "show the live level" on #2989: return
 * `data.current`. Today's rule (owner, 26 Oct, "drawn down-only") is the lowest the day has been,
 * because Body Battery recharges at rest and the hero must not climb back.
 */
function figureShown(data: BodyBatteryEnergyInput): number {
  return Math.min(data.anchor, data.current, ...data.series.map((point) => point.v))
}

export function energyHero(data: BodyBatteryEnergyInput | null | undefined): EnergyHero {
  if (!data?.hasData) {
    return { hasData: false }
  }
  const morning = Math.round(clamp(data.anchor))
  // Never above the morning mark, whichever figure is shown.
  const level = Math.min(morning, Math.round(clamp(figureShown(data))))
  const drained = morning - level
  return {
    hasData: true,
    level,
    morning,
    drained,
    // Looked up from the number on screen, so the label always agrees with it.
    label: bodyBatteryLabelFor(level),
    sub: drained > 0 ? `woke at ${morning} · drained ${drained}` : `woke at ${morning}`,
    origin:
      `set${bodyBatteryAnchorSuffix(data.anchorSource)}` +
      (data.anchorProvisional ? BODY_BATTERY_PROVISIONAL_SUFFIX : ''),
    limited: !!data.confidence && !data.confidence.sufficient,
  }
}
