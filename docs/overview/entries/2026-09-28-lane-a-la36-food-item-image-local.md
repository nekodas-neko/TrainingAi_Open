# 2026-09-28 — LA-36: the device's food reads carry the picture

BF-35 stores a food's picture on the device as bytes, precisely so it renders offline, but all
three local reads dropped it. `searchFoodItems` used `SELECT *` and the mapper skipped the column.
Recent foods and the item embedded in a day's logs never selected it. The server's `rowToFoodItem`
returned it from every read, so the canonical runtime was the one surface losing the field. All
three now return `imageDataUri` (null when absent). An in-memory SQLite test fails on all three
with the fix reverted. The 74 local-store and nutrition test files pass.

No list renders a food item's picture yet, so this changes nothing on screen by itself. The
render is Lane B's, and the entry is re-laned there.
