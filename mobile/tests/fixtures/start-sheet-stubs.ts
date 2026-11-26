// Stand-ins for the shared UI barrel and the activity-type tiles, for the Start sheet test (#4100).
import { createElement as h, type ReactNode } from 'react';

type P = Record<string, unknown> & { children?: ReactNode };
export const Sheet = ({ visible, children, title }: P) =>
  visible ? h('section', { 'aria-label': title as string }, children) : null;
export const Stack = ({ children }: P) => h('div', null, children);
export const Card = ({ children }: P) => h('div', null, children);
export const AppText = ({ children }: P) => h('span', null, children);
export const Notice = ({ title, message }: P) => h('p', null, `${title} / ${message}`);
export const AppButton = ({ title, onPress }: P) =>
  h('button', { onClick: onPress as () => void }, title as string);
export const HubCard = ({ title, onPress }: P) =>
  h('button', { onClick: onPress as () => void }, title as string);
export const ChoiceTiles = ({ label }: P) => h('div', null, label as string);
// The real tiles draw their own error; the sheet must not rely on that.
export const ActivityTypeTiles = () => h('div', null, 'activity tiles');
