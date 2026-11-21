import type { HealthPanel } from '../../features/health/screens/HealthScreen';
import type { Route } from '../../app/navigation/stack';
import type { Tab } from '../../app/navigation/tabs';

/** What the browser preview's screen script may drive (#3761). */
export type PreviewControls = {
  selectTab(tab: Tab): void;
  open(tab: Tab, route: Route): void;
  healthPanel(panel: HealthPanel): void;
  nutritionDate(date: string): void;
  /** The tab and the screen on top, for the script to confirm where it landed. */
  where(): { tab: Tab; screen: string | null };
};
/** Every build but the browser preview's development export: nothing. */
export function usePreviewControls(_controls: PreviewControls): void {}
