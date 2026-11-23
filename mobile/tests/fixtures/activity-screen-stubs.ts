// #4099: stand-ins for what the activity screen imports, so the real ActivityScreen renders with
// react-dom/server. Icons and buttons print their name, so a test can read what was drawn.
import { createElement as h, type ReactNode } from 'react';

type Props = Record<string, unknown> & { children?: ReactNode };
const box = (name: string) => ({ children }: Props) => h('div', { 'data-ui': name }, children);
export const View = box('View');
export const Stack = box('Stack');
export const Grid = box('Grid');
export const Card = box('Card');
export const Sheet = box('Sheet');
export const ConfirmationCard = box('ConfirmationCard');
export const AppText = ({ children }: Props) => h('span', null, children);
export const PageLayout = ({ title, children, footer }: Props) =>
  h('main', { 'data-ui': 'PageLayout', 'aria-label': title as string }, children, footer as ReactNode);
export const Icon = ({ name }: Props) => h('i', { 'data-ui': 'Icon', 'data-name': name as string });
export const AppButton = ({ title }: Props) => h('button', { 'data-ui': 'AppButton' }, title as string);
export const TextField = ({ label }: Props) => h('input', { 'data-ui': 'TextField', 'aria-label': label as string });
export const MetricTile = ({ label, value }: Props) => h('div', { 'data-ui': 'MetricTile' }, `${label}: ${value ?? '—'}`);
export const StatusIndicator = box('StatusIndicator');
export const LiveStrapBpm = box('LiveStrapBpm');
export const RouteMap = box('RouteMap');
export const GuidedActivityScreen = box('GuidedActivityScreen');

const anyValue: Record<string | symbol, unknown> = new Proxy(
  {},
  { get: (_t, key) => (key === Symbol.toPrimitive ? () => 8 : anyValue) },
);
export const useTheme = () => ({ theme: anyValue });
export const useHealthData = () => ({ timezone: 'Australia/Sydney', today: '2026-11-23' });
export const useWorkoutResource = () => ({ data: undefined, loading: false, error: null });
export const useTrainingKeepAwake = () => {};
export const useStrap = () => ({ state: {} });
export const noStrapHint = () => null;
export const failureNotice = (notice: string) => notice;
export const profileSpec = {};
export const hrWindowSpec = () => ({});
export const gpsStatusText: Record<string, string> = { tracking: 'Tracking' };
// What a recording says before the first fix: no distance, no pace, nothing yet.
export const useRouteRecording = (): Record<string, unknown> => ({
  eligible: false,
  status: 'tracking',
  notice: null,
  background: 'off',
  distanceKm: null,
  paceSecPerKm: null,
  splits: [],
  gainM: null,
  lossM: null,
});

/** Set by the test: the session the screen reads. */
export const current: { session: unknown; route: unknown[] } = { session: null, route: [] };
export const useActivities = () => ({ session: current.session, route: current.route, store: {}, error: null });
export const elapsedMs = () => 0;
export const formatDuration = (seconds: number) => String(seconds);
