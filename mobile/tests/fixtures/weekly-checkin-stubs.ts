// Plain-HTML stand-ins for the shared UI the weekly check-in card and sheet use (#3890), so the real
// components render with react-dom/server here. Each control records its handler by its visible
// title or label, so a test can tap it; each choice renders which option is selected.
import { createElement as h, type ReactNode } from 'react';
import { spacing, sizes, radii } from '../../src/shared/theme/tokens.ts';

type Props = Record<string, unknown> & { children?: ReactNode };
export const controls = new Map<string, () => void>();
export const choices = new Map<string, (value: unknown) => void>();
const box =
  (tag: string, name: string) =>
  ({ children, numberOfLines, accessibilityLabel }: Props) =>
    h(
      tag,
      {
        'data-ui': name,
        'data-lines': numberOfLines as number | undefined,
        'aria-label': accessibilityLabel as string | undefined,
      },
      children,
    );

export const AppText = ({ children, numberOfLines, accessibilityLabel, tone }: Props) =>
  h(
    'span',
    {
      'data-ui': 'AppText',
      'data-lines': numberOfLines as number | undefined,
      'aria-label': accessibilityLabel as string | undefined,
      'data-tone': tone as string | undefined,
    },
    children,
  );
export const Stack = box('div', 'Stack');
export const Card = ({ children, tone }: Props) =>
  h('section', { 'data-ui': 'Card', 'data-tone': tone as string }, children);
export const AppButton = ({ title, onPress, disabled, busy, accessibilityLabel }: Props) => {
  if (onPress && !disabled && !busy) controls.set((accessibilityLabel ?? title) as string, onPress as () => void);
  return h(
    'button',
    {
      'aria-label': accessibilityLabel as string | undefined,
      disabled: !!disabled || !!busy,
      'data-busy': busy ? 'yes' : undefined,
    },
    title as string,
  );
};
type Option = { label: string; value: unknown };
const options =
  (name: string) =>
  ({ label, options: list, value, onChange }: Props) => {
    choices.set(label as string, onChange as (value: unknown) => void);
    return h(
      'fieldset',
      { 'data-ui': name, 'aria-label': label as string },
      (list as Option[]).map((o) =>
        h('label', { key: String(o.value), 'data-selected': o.value === value ? 'yes' : 'no' }, o.label),
      ),
    );
  };
export const SegmentedControl = options('SegmentedControl');
export const ChipPicker = options('ChipPicker');
export const WeekdayPicker = ({ value, onToggle }: Props) => {
  choices.set('Days off', onToggle as (value: unknown) => void);
  return h(
    'fieldset',
    { 'data-ui': 'WeekdayPicker' },
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) =>
      h('label', { key: i, 'data-selected': (value as number[]).includes(i) ? 'yes' : 'no' }, d),
    ),
  );
};
export const TextField = ({ label, value, maxLength, onChangeText }: Props) => {
  choices.set(label as string, onChangeText as (value: unknown) => void);
  return h('input', { 'aria-label': label as string, value: value as string, maxLength: maxLength as number, readOnly: true });
};
export const Sheet = ({ title, children, footer }: Props) =>
  h(
    'dialog',
    { 'data-ui': 'Sheet', open: true },
    h('h2', null, title as string),
    h('div', { 'data-ui': 'SheetScroll' }, children),
    h('footer', { 'data-ui': 'SheetFooter' }, footer as ReactNode),
  );
const colors: Record<string, string> = new Proxy({}, { get: () => '#888' });
export const useTheme = () => ({
  theme: { spacing, sizes, radii, colors, tones: { checkin: { foreground: '#fbbf24' } } },
});
