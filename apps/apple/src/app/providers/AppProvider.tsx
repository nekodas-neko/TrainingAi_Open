import type { PropsWithChildren } from 'react';
import { AccountProvider } from '../../features/account/AccountProvider';
import { HealthProvider } from '../../features/health/HealthProvider';
import { ReportsProvider } from '../../development/diagnostics/ReportsProvider';

export function AppProvider({ children }: PropsWithChildren) {
  return (
    <AccountProvider>
      <HealthProvider>
        <ReportsProvider>{children}</ReportsProvider>
      </HealthProvider>
    </AccountProvider>
  );
}
