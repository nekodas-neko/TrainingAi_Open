// The phase the web layer reports to the Android shell (window.AndroidPip.updatePhase).
// The shell enters picture-in-picture on leave only for the four active phases, and starts in
// "idle" (no workout), so every other value here means "do not open PiP". See PipPolicy.kt.

export type PipPhase = 'idle' | 'pre' | 'set' | 'rest' | 'complete' | 'summary' | 'done'

interface PipPhaseInput {
  mode: string
  workoutPhase: string
  currentSet: number
  sets: number
}

export function pipPhaseFor(s: PipPhaseInput): PipPhase {
  if (s.mode === 'exercise-summary') return 'summary'
  if (s.mode === 'active') {
    if (s.workoutPhase === 'set') return 'set'
    return s.currentSet >= s.sets ? 'complete' : 'rest'
  }
  if (s.mode === 'done') return 'done'
  // 'pre', 'warmup' and anything else: no workout is running
  return 'pre'
}

export function sendPipPhase(phase: PipPhase): void {
  if (typeof window === 'undefined') return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bridge = (window as any).AndroidPip as { updatePhase: (p: string) => void } | undefined
  bridge?.updatePhase(phase)
}
