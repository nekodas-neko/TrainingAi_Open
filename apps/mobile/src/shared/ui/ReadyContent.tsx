import { useEffect, useState, type PropsWithChildren, type ReactNode } from 'react';
export function ReadyContent({
  ready,
  placeholder,
  children,
}: PropsWithChildren<{ ready: boolean; placeholder: ReactNode }>) {
  const [opened, setOpened] = useState(ready);
  useEffect(() => {
    if (ready) {
      setOpened(true);
    }
  }, [ready]);
  return opened || ready ? children : placeholder;
}
