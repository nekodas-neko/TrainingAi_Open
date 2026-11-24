// Stand-ins for the shared UI barrel, for the InProgressSheet test (#4099).
import { createElement as h, type ReactNode } from 'react';

type P = Record<string, unknown> & { children?: ReactNode };
export const Sheet = ({ visible, children, title }: P) =>
  visible ? h('section', { 'aria-label': title as string }, children) : null;
export const Stack = ({ children }: P) => h('div', null, children);
export const Notice = ({ title, message }: P) => h('p', null, `${title} / ${message}`);
export const AppButton = ({ title, onPress }: P) =>
  h('button', { onClick: onPress as () => void }, title as string);
export const ConfirmationCard = ({ confirmLabel, cancelLabel, onConfirm, onCancel }: P) =>
  h(
    'div',
    null,
    h('button', { onClick: onConfirm as () => void }, confirmLabel as string),
    h('button', { onClick: onCancel as () => void }, cancelLabel as string),
  );
