import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  filterMeals,
  mealCountLine,
  mealTags,
} from '../src/features/nutrition/data/saved-meal-list.ts';

const meal = (name: string, ...ingredients: string[]) => ({
  name,
  items: ingredients.map((food) => ({ foodItem: { name: food } })),
});
const meals = [meal('Porridge', 'Oats', 'Milk'), meal('Chicken bowl', 'Rice', 'Chicken')];

test('the filter matches a meal by its name or any ingredient, ignoring case and padding', () => {
  assert.deepEqual(filterMeals(meals, ' PORR ').map((m) => m.name), ['Porridge']);
  assert.deepEqual(filterMeals(meals, 'chicken').map((m) => m.name), ['Chicken bowl']);
  assert.deepEqual(filterMeals(meals, 'milk').map((m) => m.name), ['Porridge']);
  assert.deepEqual(filterMeals(meals, 'xyz'), []);
});

test('an empty filter keeps every meal, in order, as a copy', () => {
  const all = filterMeals(meals, '   ');
  assert.deepEqual(all, meals);
  assert.notEqual(all, meals);
});

test('the count says "1 item", not "1 items"', () => {
  assert.equal(mealCountLine(1), '1 item');
  assert.equal(mealCountLine(3), '3 items');
});

test('meal tags show four and count the rest, ignoring deleted types', () => {
  const types = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }));
  const { shown, extra } = mealTags(types, ['a', 'b', 'c', 'd', 'e', 'gone']);
  assert.deepEqual(shown.map((t) => t.id), ['a', 'b', 'c', 'd']);
  assert.equal(extra, 1);
  assert.deepEqual(mealTags(types, []), { shown: [], extra: 0 });
});
