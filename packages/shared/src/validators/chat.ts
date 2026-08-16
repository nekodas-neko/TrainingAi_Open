import { z } from "zod";

export const chatSchema = z.object({
  prompt: z.string().min(1, "Prompt is required").max(4000, "Prompt too long"),
  conversationHistory: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(8000),
    }),
  ).max(50),
  speakAloud: z.boolean().optional(),
  // Accept both separators: the client sends localDateString() → 'YYYY/MM/DD' (slashes),
  // and the route normalizes slashes→dashes before use. A dash-only regex rejected every
  // real request with a Zod "invalid_format" error before the handler ran.
  localDate: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).optional(),
});

export type TChatSchema = z.infer<typeof chatSchema>;
