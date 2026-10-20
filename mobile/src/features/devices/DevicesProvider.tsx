import type { PropsWithChildren } from 'react';
import { StrapProvider } from './strap/StrapProvider';
import { ScaleProvider } from './scale/ScaleProvider';

/** The direct Bluetooth devices: the chest strap and the body-composition scale (#2844). */
export function DevicesProvider({ children }: PropsWithChildren) {
  return (
    <StrapProvider>
      <ScaleProvider>{children}</ScaleProvider>
    </StrapProvider>
  );
}
