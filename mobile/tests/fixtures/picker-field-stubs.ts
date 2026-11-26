// #4144: stand-ins for what DateField and TimeField import besides React Native, so the real
// fields and the real Sheet run in a DOM. The calendar and wheels are reduced to buttons; the
// button keeps its `disabled`, which the shared stubs' button drops.
import { createElement as h, type ReactNode } from 'react';

export * from './sheet-dom-stubs.ts';

type ButtonProps = { title: string; onPress?: () => void; disabled?: boolean };
export const AppButton = ({ title, onPress, disabled }: ButtonProps) =>
  h('button', { onClick: onPress, disabled: !!disabled }, title);

export const MonthCalendar = ({
  month,
  onSelect,
}: {
  month: string;
  onSelect: (date: string) => void;
}) =>
  h(
    'div',
    null,
    h('span', null, `month ${month}`),
    ...['05', '12', '20'].map((day) =>
      h('button', { key: day, onClick: () => onSelect(`${month}-${day}`) }, `day ${month}-${day}`),
    ),
  );

export const NumberWheel = ({ label, value }: { label: string; value: string; children?: ReactNode }) =>
  h('div', { role: 'group', 'aria-label': label }, `${label} ${value}`);
