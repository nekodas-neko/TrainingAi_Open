import type { SegmentKind } from '@/lib/walk/interval-plan'

/**
 * A phase change is only a change if a phase was already showing. On mount there IS an
 * active segment and nothing has changed — cueing there fires the moment the screen opens,
 * including when a walk already in progress is resumed after the app is reopened.
 */
export function shouldCuePhaseChange(lastIndex: number | null, index: number | null): boolean {
  return lastIndex !== null && index !== null && index !== lastIndex
}

/**
 * Fast is the only phase that asks for more effort, so it takes the stronger pattern.
 *
 * With the phone in a pocket the pattern is the whole signal: the notification's text is
 * unreadable, and its sound is the same in both directions because every walk cue posts to
 * one channel and the plugin's per-channel `vibration` is a boolean, not a pattern.
 */
export function phaseCueHaptic(kind: SegmentKind): 'strong' | 'light' {
  return kind === 'fast' ? 'strong' : 'light'
}
