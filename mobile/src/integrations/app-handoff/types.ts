export type HandoffOutcome =
  | 'returned'
  | 'stayed_behind'
  // TrainingAi was no longer in front when the hand-off was asked for, so nothing opened.
  | 'not_foreground'
  | 'never_left'
  | 'not_installed'
  | 'launch_failed'
  | 'busy';
export type HandoffResult = {
  outcome: HandoffOutcome;
  method: 'moveTaskToFront' | 'launchIntent' | null;
  overlayGranted: boolean;
  elapsedMs: number;
  error: string | null;
};
// Briefly opens another app and brings TrainingAi back to the front (#2896). Android only.
export type AppHandoff = {
  isInstalled(packageName: string): boolean;
  canDrawOverlays(): boolean;
  openOverlaySettings(): void;
  openAppBriefly(packageName: string, handBackMs: number): Promise<HandoffResult>;
};
