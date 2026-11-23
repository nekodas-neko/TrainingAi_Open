// #4056 — what a schema has to look like for Gemini to accept it, checked on the request body the
// Google provider actually builds. No model call: `fetch` is replaced and the body captured.
//
// The schema is not converted here. The AI SDK turns the zod schema into JSON Schema
// (`zodSchema` in @ai-sdk/provider-utils, `io: "input"`) and @ai-sdk/google turns that into
// Gemini's OpenAPI subset (`convertJSONSchemaToOpenAPISchema`, not exported, run by its
// `prepareTools` for function declarations and by `getArgs` for `responseSchema`). Driving the
// provider end to end runs both exactly as production does.
import { generateObject, generateText, type ToolSet } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { z } from 'zod'
import { COACH_MODEL_ID } from '@/lib/ai/instrument'

type Body = {
  tools?: Array<{ functionDeclarations?: Array<{ name: string; parameters?: unknown }> }>
  generationConfig?: { responseSchema?: unknown }
}

async function captureBody(run: (model: ReturnType<ReturnType<typeof createGoogleGenerativeAI>>) => Promise<unknown>): Promise<Body> {
  let body: Body | undefined
  const google = createGoogleGenerativeAI({
    apiKey: 'test-key-not-used',
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ error: { code: 400, message: 'captured', status: 'INVALID_ARGUMENT' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  await run(google(COACH_MODEL_ID)).catch(() => {})
  if (!body) throw new Error('the provider never built a request')
  return body
}

/** The function declarations Gemini would receive for this tool set. */
export async function functionDeclarationsFor(tools: ToolSet) {
  const body = await captureBody(model => generateText({ model, tools, prompt: 'x', maxRetries: 0 }))
  return (body.tools ?? []).flatMap(t => t.functionDeclarations ?? [])
}

/** The `responseSchema` Gemini would receive for a structured-output call with this schema. */
export async function responseSchemaFor(schema: z.ZodType) {
  const body = await captureBody(model => generateObject({ model, schema, prompt: 'x', maxRetries: 0 }))
  return body.generationConfig?.responseSchema
}

/**
 * Everything in a converted schema Gemini is known to refuse, as `path: reason`.
 *
 * - `enum` with a value that is not a string. Gemini's Schema documents `enum` as "possible values
 *   of the element of Type.STRING", and refuses anything else: "Invalid value at
 *   '…any_of[0].enum[0]' (TYPE_STRING), -1" (#4056). The provider rewrites every `const` to a
 *   one-value `enum`, so a number or boolean `z.literal` lands here too.
 * - `enum` on a node whose `type` is not "string", for the same documented reason.
 * - `const` left in the output (the provider's converter should never emit one).
 */
export function geminiRefusals(schema: unknown, path = '$'): string[] {
  if (schema == null || typeof schema !== 'object') return []
  if (Array.isArray(schema)) return schema.flatMap((s, i) => geminiRefusals(s, `${path}[${i}]`))
  const node = schema as Record<string, unknown>
  const out: string[] = []
  if ('enum' in node) {
    const values = node.enum as unknown[]
    const bad = values.filter(v => typeof v !== 'string')
    if (bad.length) out.push(`${path}.enum: non-string value(s) ${JSON.stringify(bad)}`)
    if (node.type !== undefined && node.type !== 'string') out.push(`${path}.enum: on type ${JSON.stringify(node.type)}`)
  }
  if ('const' in node) out.push(`${path}.const: ${JSON.stringify(node.const)}`)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'enum' || key === 'const') continue
    if (key === 'properties' && value && typeof value === 'object') {
      for (const [prop, sub] of Object.entries(value)) out.push(...geminiRefusals(sub, `${path}.properties.${prop}`))
    } else if (typeof value === 'object') {
      out.push(...geminiRefusals(value, `${path}.${key}`))
    }
  }
  return out
}
