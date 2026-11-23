// #4099: stand-ins for what Sheet and ScreenBoundary import besides React Native, which the test
// replaces with react-native-web so the real Sheet runs in a DOM.
import { createElement as h, type ReactNode } from 'react';
import { View } from 'react-native';

type Props = { children?: ReactNode; label?: string; title?: string; action?: string; onAction?: () => void };
export const ReorderScrollView = ({ children }: Props) => h(View, null, children);
export const IconButton = ({ label }: Props) => h('button', null, label);
export const AppText = ({ children }: Props) => h('span', null, children);
export const Stack = ({ children }: Props) => h(View, null, children);
export const feedback = () => {};
const anyValue: Record<string | symbol, unknown> = new Proxy(
  {},
  { get: (_t, key) => (key === Symbol.toPrimitive ? () => 8 : anyValue) },
);
export const useTheme = () => ({ theme: anyValue });
export const SafeAreaView = View;
export const useReducedMotion = () => false;
export const PageLayout = ({ title, children }: Props) =>
  h('main', { 'aria-label': title }, children);
export const StateCard = ({ title, action }: Props) =>
  h('section', { role: 'alert' }, `${title} / ${action}`);
export const reported: unknown[] = [];
export const reportError = (error: unknown) => void reported.push(error);
