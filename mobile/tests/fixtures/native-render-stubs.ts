// Plain-HTML stand-ins for the React Native layer, so a feature component can be rendered with
// react-dom/server in this runner (which cannot load React Native). Only what the cards use.
import { createElement as h, type ReactNode } from 'react';

type Props = Record<string, unknown> & { children?: ReactNode };
const box =
  (tag: string, name: string) =>
  ({ children }: Props) =>
    h(tag, { 'data-ui': name }, children);

/** The last `onPress` a stub Pressable rendered, so a test can tap it. */
export const pressed: { onPress?: () => void } = {};

export const View = box('div', 'View');
export const StyleSheet = { hairlineWidth: 1, create: <T>(x: T) => x };
export const AppText = box('span', 'AppText');
export const Card = box('section', 'Card');
export const Stack = box('div', 'Stack');
export const Grid = box('div', 'Grid');
export const DisclosureIcon = ({ expanded }: Props) => h('i', null, expanded ? 'v' : '>');
export const Disclosure = ({ title, children }: Props) =>
  h('details', null, h('summary', null, title as string), children);
export const MetricTile = ({ label, value, caption }: Props) =>
  h(
    'div',
    { 'data-ui': 'MetricTile' },
    `${label}: ${value ?? '—'}`,
    caption ? ` (${caption})` : '',
  );
export const LineChart = ({ points, markers, label }: Props) =>
  h('figure', {
    'data-ui': 'LineChart',
    'aria-label': label as string,
    'data-points': (points as { label: string; value: number }[])
      .map((p) => `${p.label}=${p.value}`)
      .join(','),
    'data-markers': ((markers as { x: number }[] | undefined) ?? []).map((m) => m.x).join(','),
  });
export const Pressable = ({ children, onPress, accessibilityLabel }: Props) => {
  pressed.onPress = onPress as () => void;
  return h('button', { 'aria-label': accessibilityLabel as string }, children);
};
export const layoutMotion = () => {};
export const useReducedMotion = () => false;
export const useCueColor = () => () => '#888';
const anyColor: Record<string, unknown> = new Proxy(
  {},
  { get: (_t, key) => (key === 'xs' || key === 'touchTarget' ? 8 : anyColor) },
);
export const useTheme = () => ({ theme: anyColor });
