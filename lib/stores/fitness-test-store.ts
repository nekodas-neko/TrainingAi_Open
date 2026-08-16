'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FitnessTestId } from '@trainingai/shared/fitness-tests/protocols'

export type FitnessTestMode = 'select' | 'countdown' | 'active' | 'done'

interface FitnessTestState {
  mode: FitnessTestMode
  selectedProtocolId: FitnessTestId | null
  startedAtMs: number | null
  choose: (id: FitnessTestId) => void
  beginCountdown: () => void
  start: (atMs: number) => void
  finish: () => void
  reset: () => void
}

export const useFitnessTestStore = create<FitnessTestState>()(
  persist(
    (set) => ({
      mode: 'select',
      selectedProtocolId: null,
      startedAtMs: null,
      choose: (id) => set({ selectedProtocolId: id, mode: 'countdown' }),
      beginCountdown: () => set({ mode: 'countdown' }),
      start: (atMs) => set({ mode: 'active', startedAtMs: atMs }),
      finish: () => set({ mode: 'done' }),
      reset: () => set({ mode: 'select', selectedProtocolId: null, startedAtMs: null }),
    }),
    {
      name: 'ta-fitness-test',
      // Only the chosen protocol survives a reload; the flow mode + timer are
      // transient and must never rehydrate mid-test (Zustand persisted-store rule).
      partialize: (s) => ({ selectedProtocolId: s.selectedProtocolId }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.mode = 'select'
          state.startedAtMs = null
        }
      },
    },
  ),
)
