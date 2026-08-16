import { z } from "zod";

// Chart payload shape, validated before anything reaches chart.js — a valid-JSON-but-wrong-shape
// payload (e.g. `datasets` an object, not an array) threw during render and unmounted the whole
// surface (F2). Coach's widget protocol is the only consumer now.
//
// The `parseChartBlocks` function that used to live here — which pulled `<sheet_chart>` blocks out
// of free-text model output — went with the legacy chat surface in Q-189. Coach never used it: its
// charts arrive as a structured widget, which is the whole reason it is not the in-text block
// pattern (see `lib/coach/widgets.ts`).
const ChartColor = z.union([z.string(), z.array(z.string())]);

const ChartDatasetSchema = z.object({
  label: z.string(),
  data: z.array(z.number()),
  backgroundColor: ChartColor.optional(),
  borderColor: ChartColor.optional(),
  borderWidth: z.number().optional(),
  fill: z.boolean().optional(),
  tension: z.number().optional(),
});

const ChartPayloadSchema = z.object({
  type: z.enum(["bar", "line", "pie"]),
  title: z.string().optional(),
  labels: z.array(z.string()),
  datasets: z.array(ChartDatasetSchema).min(1),
});

export type ChartDataset = z.infer<typeof ChartDatasetSchema>;
export type ChartPayload = z.infer<typeof ChartPayloadSchema>;
