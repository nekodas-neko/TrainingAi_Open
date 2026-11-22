// #4061: stand-ins for what the set card imports, so the real SetEntry renders with react-dom/server.
// Every control prints its label, so a test can list what the card shows.
import { createElement as h, type ReactNode } from 'react';

type Props = Record<string, unknown> & { children?: ReactNode };
const labelled =
  (name: string) =>
  ({ label, title, caption, children }: Props) =>
    h('div', { 'data-ui': name, 'aria-label': (label ?? title ?? caption) as string }, children);

export const View = ({ children }: Props) => h('div', { 'data-ui': 'View' }, children);
export const Stack = ({ children }: Props) => h('div', { 'data-ui': 'Stack' }, children);
export const AppButton = labelled('AppButton');
export const Disclosure = labelled('Disclosure');
export const NumberWheel = labelled('NumberWheel');
export const SegmentedControl = labelled('SegmentedControl');
export const RepCounter = labelled('RepCounter');
export const ChoiceScale = labelled('ChoiceScale');
export const VoiceLogButton = labelled('VoiceLogButton');
export const feedback = () => {};
export const applyHeardSet = () => {};
export const useVoiceEngine = () => null;
export const useWorkoutJournal = () => ({ busy: false, controller: null });
// Any theme value: a nested lookup, or 8 where the card does arithmetic with it.
const anyValue: Record<string | symbol, unknown> = new Proxy(
  {},
  { get: (_t, key) => (key === Symbol.toPrimitive ? () => 8 : anyValue) },
);
export const useTheme = () => ({ theme: anyValue, textScale: 1 });
