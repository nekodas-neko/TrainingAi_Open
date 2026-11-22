// Stand-ins for what the header components import, so the real PageHeader, IconButton, PageLayout,
// WorkoutLayout and HealthHero render under react-dom/server. Each box writes its flattened style
// and props into the markup, so a test can read them back. IconButton is NOT stubbed.
import { createElement as h, type ReactNode } from 'react';
import { radii, sizes, spacing } from '../../src/shared/theme/tokens.ts';

type Props = Record<string, unknown> & { children?: ReactNode };
const flat = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.map(flat))
    : ((style as Record<string, unknown>) ?? {});
const gapOf = (gap: unknown) => spacing[(gap ?? 'sm') as keyof typeof spacing];
const box = (ui: string) =>
  function Box({ children, style }: Props) {
    return h('div', { 'data-ui': ui, 'data-style': JSON.stringify(flat(style)) }, children);
  };

export const View = box('View');
export const ScrollView = box('ScrollView');
export const KeyboardAvoidingView = box('KeyboardAvoidingView');
export const ReorderScrollView = box('ReorderScrollView');
export const NestedScrollGesture = { Provider: ({ children }: Props) => children };
export const useNestedScrollBoundary = () => ({ control: {}, locked: false });
export const useAndroidBack = () => {};
export const Platform = { OS: 'android' };
export const StyleSheet = { absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } };
export const ActivityIndicator = () => null;
export const RefreshControl = () => null;
export const PageGradient = () => null;
export const HealthArtwork = () => null;
export const SessionTimer = () => h('i', { 'data-ui': 'SessionTimer' });
const Svg = ({ children }: Props) => children;
export default Svg;
export const Defs = Svg;
export const LinearGradient = Svg;
export const Stop = () => null;
export const Rect = () => null;
export const Stack = ({ children, style, direction, gap, align }: Props) =>
  h(
    'div',
    {
      'data-ui': 'Stack',
      'data-style': JSON.stringify({ direction, gap: gapOf(gap), alignItems: align, ...flat(style) }),
    },
    children,
  );
export const AppText = ({ children, variant, numberOfLines }: Props) =>
  h('span', { 'data-ui': 'AppText', 'data-variant': variant, 'data-lines': numberOfLines }, children);
/** Resolves the style function the way React Native does (not pressed), so the real IconButton's size shows. */
export const Pressable = ({ children, style, accessibilityLabel }: Props) =>
  h(
    'button',
    {
      'data-ui': 'Pressable',
      'aria-label': accessibilityLabel,
      'data-style': JSON.stringify(
        flat(typeof style === 'function' ? (style as (s: object) => unknown)({ pressed: false }) : style),
      ),
    },
    children,
  );
export const Icon = ({ name }: Props) => h('i', { 'data-ui': 'Icon', 'data-icon': name });
const byKind = Object.fromEntries(
  ['sleep', 'readiness', 'activity', 'heart-rate'].map((k) => [k, { dark: 'x', light: 'x' }]),
);
export const useTheme = () => ({
  theme: {
    mode: 'dark',
    spacing,
    sizes,
    radii,
    colors: { border: '#333', raised: '#222', muted: '#999' },
    healthArtColors: { lightChip: '#fff', darkChip: '#111' },
    healthHeroGradients: byKind,
    healthPageGradients: byKind,
  },
});
