'use client'

import { useState } from 'react'
import type { FoodItem } from '@trainingai/shared/types/nutrition'
import { qtyFromInput, steppedQty, type QtyUnit } from './saved-meal-qty'

export interface IngredientEntry {
  item: FoodItem
  qty: number
}

/**
 * The meal builder's ingredient list, and how much of each.
 *
 * Extracted from `saved-meals-sheet.tsx` when BF-11f's tag chips took that file past the 800-line
 * ceiling. It is the fifth extraction out of that builder in three entries, and — like the save
 * write before it — it is logic rather than markup, so it leaves without threading a prop.
 *
 * `saved-meal-qty.ts` already owns the arithmetic; this owns the state around it. The split is why
 * neither half needs the other's tests.
 */
export function useIngredientQuantities() {
  const [ingredients, setIngredients] = useState<IngredientEntry[]>([])
  const [unitById, setUnitById] = useState<Record<string, QtyUnit>>({})

  function addIngredient(item: FoodItem) {
    setIngredients(prev => {
      const existing = prev.find(e => e.item.id === item.id)
      if (existing) return prev.map(e => e.item.id === item.id ? { ...e, qty: e.qty + 1 } : e)
      return [...prev, { item, qty: 1 }]
    })
  }

  /**
   * Add several ingredients at once, summing the quantity where one is already in the list.
   *
   * Two callers need exactly this and differ only in what ELSE they set: a pasted recipe also fills
   * the meal's name and servings (BF-11c), a flattened saved meal sets nothing but the rows
   * (BF-161). The merge itself is the same, and two copies of a merge is how they drift.
   */
  function addEntries(entries: IngredientEntry[]) {
    setIngredients(prev => {
      const next = [...prev]
      for (const { item, qty } of entries) {
        const at = next.findIndex(e => e.item.id === item.id)
        if (at === -1) next.push({ item, qty })
        else next[at] = { ...next[at], qty: next[at].qty + qty }
      }
      return next
    })
  }

  function removeIngredient(id: string) {
    setIngredients(prev => prev.filter(e => e.item.id !== id))
  }

  /**
   * Quantity is entered in servings or in grams, per ingredient, the way MyFitnessPal does it.
   *
   * Servings is the default because that is what "a scoop of whey" means, and the app stores a
   * serving multiplier either way — grams is a second view of the same number, not a second number.
   * An item with no serving size has no gram equivalent, so it only ever offers servings.
   */
  function unitFor(item: FoodItem): QtyUnit {
    return (item.servingSizeG ?? 0) > 0 ? (unitById[item.id] ?? 'serving') : 'serving'
  }

  function setUnit(id: string, unit: QtyUnit) {
    setUnitById(prev => ({ ...prev, [id]: unit }))
  }

  function setDisplayQty(item: FoodItem, raw: string, unit: QtyUnit) {
    const next = qtyFromInput(raw, unit, item.servingSizeG)
    if (next == null) return
    setIngredients(prev => prev.map(e => e.item.id === item.id ? { ...e, qty: next } : e))
  }

  /** ± moves by half a serving, or by 5 g — whichever unit the row is currently showing. */
  function stepQty(item: FoodItem, unit: QtyUnit, direction: 1 | -1) {
    setIngredients(prev =>
      prev.flatMap(e => {
        if (e.item.id !== item.id) return [e]
        const next = steppedQty(e.qty, unit, direction, item.servingSizeG)
        return next == null ? [] : [{ ...e, qty: next }]
      })
    )
  }

  return {
    ingredients, setIngredients,
    addIngredient, addEntries, removeIngredient,
    unitFor, setUnit, setDisplayQty, stepQty,
  }
}
