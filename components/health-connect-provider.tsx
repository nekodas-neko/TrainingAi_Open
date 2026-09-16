'use client';

import { useEffect } from 'react';
import { useUserTimezone } from '@/components/shell/user-timezone-provider';

export function HealthConnectProvider() {
  // `syncHealthConnect` takes the user's timezone and defaults to `DEFAULT_TZ` (Brisbane) — right
  // for the owner, wrong for anyone else, and silent either way. That default is the shape CLAUDE.md
  // warns about: a safety net every caller is supposed to override is what makes forgetting
  // invisible. This provider is mounted inside `UserTimezoneProvider` (app/layout.tsx), which is fed
  // `session?.user?.timezone`, so the real value is available on the first render — no flip from a
  // placeholder, and no double sync (LB-113).
  const tz = useUserTimezone();

  useEffect(() => {
    import('@/lib/health-connect-sync').then(({ syncHealthConnect }) => {
      syncHealthConnect(tz).catch(() => {});
    });
  }, [tz]);

  return null;
}
