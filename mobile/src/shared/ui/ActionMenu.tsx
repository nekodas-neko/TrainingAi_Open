import { useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { AppButton } from './AppButton';
import type { IconName } from './Icon';
export type MenuAction = {
  title: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
};
export function ActionMenu({
  visible,
  title,
  onClose,
  actions,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  actions: readonly MenuAction[];
}) {
  const [closing, setClosing] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  return (
    <Sheet
      visible={visible && !closing}
      title={title}
      onClose={onClose}
      onDismiss={() => {
        if (!closing) return;
        const run = pending.current;
        pending.current = null;
        setClosing(false);
        onClose();
        run?.();
      }}
    >
      {actions.map((action) => (
        <AppButton
          key={action.title}
          title={action.title}
          icon={action.icon}
          variant={action.danger ? 'danger' : 'surface'}
          disabled={action.disabled || closing}
          onPress={() => {
            if (closing) return;
            pending.current = action.run;
            setClosing(true);
          }}
        />
      ))}
    </Sheet>
  );
}
