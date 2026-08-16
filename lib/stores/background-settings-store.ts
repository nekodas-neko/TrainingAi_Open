import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ManualLocation } from '@/lib/weather/types'

export type BackgroundSection = 'home' | 'health' | 'workout' | 'nutrition' | 'more'

interface BackgroundSettingsState {
  enabled: boolean
  sections: Record<BackgroundSection, boolean>
  manualLocation: ManualLocation | null
  setEnabled: (enabled: boolean) => void
  setSectionEnabled: (section: BackgroundSection, enabled: boolean) => void
  setManualLocation: (location: ManualLocation | null) => void
}

const DEFAULT_SECTIONS: Record<BackgroundSection, boolean> = {
  home: true,
  health: true,
  workout: true,
  nutrition: true,
  more: true,
}

export const useBackgroundSettingsStore = create<BackgroundSettingsState>()(
  persist(
    (set) => ({
      enabled: false,
      sections: DEFAULT_SECTIONS,
      manualLocation: null,
      setEnabled: (enabled) => set({ enabled }),
      setSectionEnabled: (section, enabled) =>
        set((s) => ({ sections: { ...s.sections, [section]: enabled } })),
      setManualLocation: (manualLocation) => set({ manualLocation }),
    }),
    {
      name: 'ta_background_settings',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
