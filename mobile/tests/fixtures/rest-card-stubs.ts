// Plain-HTML stand-ins for what the rest view imports from react-native and the shared UI (#4058), so
// the real RestCard renders with react-dom/server. Each button records its title.
import { createElement as h, type ReactNode } from 'react';
import { formatDuration } from '../../src/shared/hooks/format-duration.ts';

type Props = Record<string, unknown> & { children?: ReactNode };
export const buttons: string[] = [];

export const View = ({ children }: Props) => h('div', null, children);
export const Pressable = ({ children, onPress, accessibilityLabel }: Props) =>
  h('button', { 'data-press': onPress ? 'yes' : undefined, 'aria-label': accessibilityLabel as string }, children);
export const slopTo = () => ({});
export const AppText = ({ children }: Props) => h('span', null, children);
export const Stack = ({ children }: Props) => h('div', null, children);
export const Icon = () => null;
export const ProgressBar = () => null;
export const AppButton = ({ title }: Props) => {
  buttons.push(title as string);
  return h('button', null, title as string);
};
export const RestRing = ({ elapsedSec, targetSec }: Props) =>
  h('div', { 'data-ring': `${elapsedSec}/${targetSec}` });
export const useTheme = () => ({
  theme: { colors: { muted: '#888' }, status: { warning: '#fa0' }, anatomy: { injured: '#f00' } },
});
export const useClock = () => 0;
export { formatDuration };
export const usePipSourceRect = () => ({ ref: { current: null }, onLayout: () => {} });
export const useWorkoutJournal = () => ({ busy: false, controller: null });
