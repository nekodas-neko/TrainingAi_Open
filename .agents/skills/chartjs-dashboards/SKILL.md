---
name: chartjs-dashboards
description: Use this skill when building or modifying any chart, graph, sparkline, or data visualization with Chart.js / react-chartjs-2 — health stats, training load bars, nutrition macro charts, sleep correlation, weight/body-fat trends, ACWR. Also trigger when the user asks for a "chart", "graph", "sparkline", "trend", or a visualization of numeric data over time.
---

# Chart.js Dashboards (Health, Training, Nutrition)

## Stack

`chart.js` v4 + `react-chartjs-2` v5. Register only the elements/scales/plugins a chart actually uses (`Chart.register(...)`) — don't import the whole Chart.js bundle.

## Lazy-load chart code

Chart.js is heavy. Follow the `ExerciseStatsSheet` pattern (1.7.x): lazy-load the chart component (`next/dynamic` or dynamic `import()`) so `chart.js` isn't in the initial bundle for screens that might not open the chart-bearing sheet.

## Color conventions

Match colors already used elsewhere for the same concept — don't invent a new palette per chart:
- Set-index colors: `SET_COLORS` from `components/workout/utils.ts` (`#f59e0b` / `#22c55e` / `#8b5cf6`)
- Session-type colors: same colors used for calendar dots and training-load bar legends — build an explicit color legend component next to the chart (see Training Load legend, 1.25.4) rather than relying on Chart.js's auto-generated legend, for visual consistency with the rest of the app

## Theming

Chart gridlines, axis labels, and tooltip text must read correctly in both light and dark mode. Pull colors from CSS variables (`var(--muted-foreground)`, `var(--border)`, etc.) at render time rather than hardcoding `#666`/`rgba(0,0,0,...)`. The dynamic background + translucent cards mean charts often sit on a semi-transparent surface — verify contrast against both the lightest and darkest background states.

## Empty / insufficient-data states

Don't render an empty or misleading chart when there isn't enough data. Match the established pattern (1.20.7): show a "Not enough data yet" message instead of a chart with one data point or a flat line. ACWR and Sleep vs Performance both require a minimum data window before rendering.

## Tooltips & formatting

Reuse existing formatters for units shown in tooltips/axes — `formatTime` for durations, `formatSetLoad`/`formatSetLoadParts` for weight×reps, `todayInTz`/`fmtAest` for date/time labels (see `timezone-handling` skill — never format dates with raw `toISOString()`).

## Responsiveness

Charts run on a single target viewport (Galaxy S25 Ultra) but must not overflow their card on smaller widths during PWA/desktop testing. Use `maintainAspectRatio: false` with an explicit container height rather than relying on Chart.js's default aspect ratio, and test resizing the browser window.

## Stale-fetch protection

When a chart's data source can change rapidly (e.g. switching between exercises in the stats sheet), use an `AbortController` per fetch so a slow response for the *previous* selection can't overwrite the chart for the *current* selection (1.7.2 pattern) — and show an error state on fetch failure rather than leaving a blank sparkline.
