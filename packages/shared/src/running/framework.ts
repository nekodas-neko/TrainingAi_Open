import type { RunFramework } from './types'
import { polarizedFramework } from './frameworks/polarized'
import { speedVo2maxFramework } from './frameworks/speed-vo2max'
import { zone2BaseFramework } from './frameworks/zone2-base'
import { aerobicRecoveryFramework } from './frameworks/aerobic-recovery'
import { densityProgressionFramework } from './frameworks/density-progression'
import { norwegian4x4Framework } from './frameworks/norwegian-4x4'

// Framework registry — add a new template by adding a module + a line here. The engine,
// gate, route, and tables are framework-agnostic (design note 2).
const FRAMEWORKS: Record<string, RunFramework> = {
  [polarizedFramework.key]: polarizedFramework,
  [speedVo2maxFramework.key]: speedVo2maxFramework,
  [zone2BaseFramework.key]: zone2BaseFramework,
  [aerobicRecoveryFramework.key]: aerobicRecoveryFramework,
  [densityProgressionFramework.key]: densityProgressionFramework,
  [norwegian4x4Framework.key]: norwegian4x4Framework,
}

export const DEFAULT_FRAMEWORK_KEY = polarizedFramework.key

export function getFramework(key: string): RunFramework {
  const fw = FRAMEWORKS[key]
  if (!fw) throw new Error(`Unknown running framework: ${key}`)
  return fw
}
