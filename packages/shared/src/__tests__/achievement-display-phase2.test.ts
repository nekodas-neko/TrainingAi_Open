import { describe, it, expect } from 'vitest'
import {
  TITLE_CATALOGUE,
  TROPHY_SLOTS,
  availableTitles,
  pinTrophy,
  seasonBadgeTier,
  unpinTrophy,
} from '../achievement-display'
import { TITLES } from '../types/friends'

describe('trophy case pins', () => {
  it('holds three', () => expect(TROPHY_SLOTS).toBe(3))
  it('adds in order and drops the oldest when full', () => {
    expect(pinTrophy([], 'a')).toEqual(['a'])
    expect(pinTrophy(['a', 'b', 'c'], 'd')).toEqual(['b', 'c', 'd'])
  })
  it('leaves an achievement already pinned where it is', () => {
    expect(pinTrophy(['a', 'b'], 'a')).toEqual(['a', 'b'])
  })
  it('removes one and keeps the order of the rest', () => {
    expect(unpinTrophy(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
    expect(unpinTrophy(['a'], 'z')).toEqual(['a'])
  })
})

describe('titles', () => {
  it('offers only the titles whose achievement is unlocked, in catalogue order', () => {
    expect(availableTitles(['streak_30', 'sessions_100']).map(([id]) => id)).toEqual([
      'unbroken',
      'century_club',
    ])
    expect(availableTitles([])).toEqual([])
  })
  it('is the one list the web icons are attached to', () => {
    expect(Object.keys(TITLES)).toEqual(Object.keys(TITLE_CATALOGUE))
    for (const [id, def] of Object.entries(TITLES)) {
      expect(def.display).toBe(TITLE_CATALOGUE[id].display)
      expect(def.unlockedBy).toBe(TITLE_CATALOGUE[id].unlockedBy)
      expect(def.Icon).toBeTruthy()
    }
  })
})

describe('season badges', () => {
  it('draws Gold and Silver as such and everything else as Bronze', () => {
    expect(['Gold', 'Silver', 'Bronze', 'Participant'].map(seasonBadgeTier)).toEqual([
      'gold',
      'silver',
      'bronze',
      'bronze',
    ])
  })
})
