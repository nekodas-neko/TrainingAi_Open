// Plain-HTML stand-ins for the shared UI, the theme and the Coach launcher (#3896 steps 6-7), so the
// entry points can be rendered with react-dom/server and their controls pressed by label.
import { createElement as h, type ReactNode } from 'react';

type Props = Record<string, unknown> & { children?: ReactNode };
const box =
  (tag: string, name: string) =>
  ({ children }: Props) =>
    h(tag, { 'data-ui': name }, children);

/** Every control rendered, by its accessible label or title, so a test can press it. */
export const controls = new Map<string, () => void>();
/** Every Coach launch, in order. */
export const launches: unknown[] = [];

const control =
  (name: string) =>
  ({ children, onPress, accessibilityLabel, title, label }: Props) => {
    const key = String(accessibilityLabel ?? label ?? title ?? '');
    if (typeof onPress === 'function') controls.set(key, onPress as () => void);
    return h('button', { 'data-ui': name, 'aria-label': key }, (title as string) ?? children);
  };

export const View = box('div', 'View');
export const AppText = box('span', 'AppText');
export const Card = box('section', 'Card');
export const Stack = box('div', 'Stack');
export const Badge = ({ label }: Props) => h('em', null, label as string);
export const Icon = ({ name }: Props) => h('i', null, name as string);
export const AppButton = control('AppButton');
export const IconButton = control('IconButton');
export const Pressable = control('Pressable');
export const TouchSurface = ({ children }: Props) => h('div', { 'data-ui': 'TouchSurface' }, children);
export const ExerciseThumbnail = () => h('img');
export const ActionMenu = ({ visible, title, actions }: Props) =>
  h(
    'dialog',
    { 'data-ui': 'ActionMenu', 'data-open': String(visible), 'aria-label': title as string },
    (actions as { title: string; run: () => void }[]).map((a) => {
      controls.set(`menu:${a.title}`, a.run);
      return h('button', { key: a.title }, a.title);
    }),
  );
export const slopTo = () => 0;
// Any theme token: nested lookups work, and arithmetic on one gives a number.
const anyValue: Record<string | symbol, unknown> = new Proxy(
  {},
  { get: (_t, key) => (key === Symbol.toPrimitive ? () => 8 : anyValue) },
);
export const useWeightUnits = () => ({});
export const useTheme = () => ({ theme: anyValue });
export const useCoachLaunch = () => (request?: unknown) => {
  launches.push(request ?? {});
};
/** What a stubbed ResourceCard hands its children. */
export const resource: { data?: unknown } = {};
export const ResourceCard = ({ children }: Props) =>
  (children as unknown as (data: unknown) => ReactNode)(resource.data);
export const formatSetLoad = () => '';
