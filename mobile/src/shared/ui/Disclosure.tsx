import { useReducedMotion } from './useReducedMotion';
import { layoutMotion } from './layoutMotion';
import { useState, type PropsWithChildren } from 'react';
import { AppButton } from './AppButton';
import { Stack } from './Stack';

export function Disclosure({
  title,
  children,
  defaultOpen = false,
}: PropsWithChildren<{ title: string; defaultOpen?: boolean }>) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(defaultOpen);
  return (
    <Stack>
      <AppButton
        title={title}
        variant="ghost"
        accessibilityState={{ expanded }}
        onPress={() => {
          layoutMotion(reduced);
          setExpanded(!expanded);
        }}
      />
      {expanded && children}
    </Stack>
  );
}
