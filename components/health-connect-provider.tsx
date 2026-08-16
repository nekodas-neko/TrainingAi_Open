'use client';

import { useEffect } from 'react';

export function HealthConnectProvider() {
  useEffect(() => {
    import('@/lib/health-connect-sync').then(({ syncHealthConnect }) => {
      syncHealthConnect().catch(() => {});
    });
  }, []);

  return null;
}
