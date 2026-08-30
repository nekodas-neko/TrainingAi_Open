import { savePreference } from '@/lib/user/preferences-sync'
const KEY = "ta_rest_duration";
export const REST_DURATION_DEFAULT = 90;

export function getRestDuration(): number {
  if (typeof window === "undefined") return REST_DURATION_DEFAULT;
  const stored = localStorage.getItem(KEY);
  if (stored === null) return REST_DURATION_DEFAULT;
  const n = parseInt(stored, 10);
  return isNaN(n) || n < 0 ? REST_DURATION_DEFAULT : n;
}

export function saveRestDuration(seconds: number): void {
  savePreference('restDurationSec', seconds);
}

export const REST_DURATION_PRESETS = [
  { label: "Off", seconds: 0 },
  { label: "30s", seconds: 30 },
  { label: "60s", seconds: 60 },
  { label: "90s", seconds: 90 },
  { label: "2 min", seconds: 120 },
  { label: "2:30", seconds: 150 },
  { label: "3 min", seconds: 180 },
  { label: "4 min", seconds: 240 },
  { label: "5 min", seconds: 300 },
];
