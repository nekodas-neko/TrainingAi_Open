export type HandoffOutcome =
  | 'returned'
  | 'stayed_behind'
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
