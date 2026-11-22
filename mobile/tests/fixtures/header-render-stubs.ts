// Stand-ins for what PageHeader imports, so the real component renders under react-dom/server.
// Each box writes its flattened style and props into the markup, so a test can read them back.
import { createElement as h, type ReactNode } from 'react';
import { radii, sizes, spacing } from '../../src/shared/theme/tokens.ts';

type Props = Record<string, unknown> & { children?: ReactNode };
const flat = (style: unknown): Record<string, unknown> =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : ((style as Record<string, unknown>) ?? {});
const gapOf = (gap: unknown) => (gap === undefined ? undefined : spacing[gap as keyof typeof spacing]);

export const View = ({ children, style }: Props) =>
  h('div', { 'data-ui': 'View', 'data-style': JSON.stringify(flat(style)) }, children);
export const Stack = ({ children, style, direction, gap }: Props) =>
  h(
    'div',
    {
      'data-ui': 'Stack',
      'data-style': JSON.stringify({ direction, gap: gapOf(gap ?? 'sm'), ...flat(style) }),
    },
    children,
  );
export const AppText = ({ children, variant, numberOfLines }: Props) =>
  h('span', { 'data-ui': 'AppText', 'data-variant': variant, 'data-lines': numberOfLines }, children);
/** Records the hit size the real IconButton gives every Back: its width and height are touchTarget. */
export const IconButton = ({ icon, label, drawnWidth }: Props) =>
  h('button', {
    'data-ui': 'IconButton',
    'data-icon': icon,
    'aria-label': label,
    'data-width': drawnWidth ?? sizes.touchTarget,
    'data-height': sizes.touchTarget,
  });
export const useTheme = () => ({
  theme: {
    mode: 'dark',
    spacing,
    sizes,
    radii,
    colors: { border: '#333' },
    healthArtColors: { lightChip: '#fff', darkChip: '#111' },
  },
});
