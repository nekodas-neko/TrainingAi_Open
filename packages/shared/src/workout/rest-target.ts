// The rest a set earns when its style sets none: a style-less set still gets a real countdown,
// and the beep and the rest alarm (both gated on a target above zero) still fire (TMR-1/TMR-5).
export const DEFAULT_REST_SEC = 90

// The single rest-target derivation, shared by the current app's workout store and TrainingAi
// Preview's last-set rest (#3111).
export function effectiveRestSec(restSec: number): number {
  return restSec > 0 ? restSec : DEFAULT_REST_SEC
}
