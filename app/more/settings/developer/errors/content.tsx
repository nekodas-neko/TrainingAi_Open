"use client"

import { MoreSubScreen } from '@/components/more/sub-screen'
import ErrorsTab from '@/components/admin/errors-tab'

export function DevToolContent() {
  return (
    <MoreSubScreen title="Error log">
      <ErrorsTab />
    </MoreSubScreen>
  )
}
