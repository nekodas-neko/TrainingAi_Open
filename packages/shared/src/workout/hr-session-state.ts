// Shape of one session's HR-recovery payload from GET /api/oura/hr-data.
export interface SessionHrData {
  hasData: boolean;
  startedAt: string;
  readings: { timestamp: string; bpm: number }[];
  setStats: {
    exerciseName: string;
    setNumber: number;
    loggedAt: string | null;
    hrr1: number | null;
    adequate: boolean | null;
  }[];
}

// Raw JSON from GET /api/oura/hr-data. `ready:false` means the session has no
// completedAt (app/api/oura/hr-data/route.ts); otherwise `hasData` reflects
// whether the ±10-min window join returned any readings.
export interface HrDataResponse {
  ready?: boolean;
  hasData?: boolean;
  startedAt?: string;
  readings?: { timestamp: string; bpm: number }[];
  setStats?: SessionHrData["setStats"];
}

// UI sentinel for a session's HR-recovery block.
// 'loading'    — sync/read in flight
// 'incomplete' — session never completed (route returned ready:false); distinct from 'none'
// 'none'       — session completed but the Oura window produced no readings
export type HrSessionState = SessionHrData | "loading" | "none" | "incomplete";

export function classifyHrResponse(data: HrDataResponse): SessionHrData | "none" | "incomplete" {
  if (data.ready === false) return "incomplete";
  if (data.ready && data.hasData && data.readings) {
    return {
      hasData: true,
      startedAt: data.startedAt ?? "",
      readings: data.readings,
      setStats: data.setStats ?? [],
    };
  }
  return "none";
}

export function hrEmptyMessage(state: "none" | "incomplete"): string {
  return state === "incomplete"
    ? "This workout wasn't marked complete, so there's no HR recovery to show"
    : "No HR data — ensure Oura was worn and synced";
}
