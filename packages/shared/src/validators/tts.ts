import { z } from "zod";

export const ttsSchema = z.object({
  text: z.string().min(1, "Text is required").max(2000, "Text too long"),
});

export type TTTSchema = z.infer<typeof ttsSchema>;
