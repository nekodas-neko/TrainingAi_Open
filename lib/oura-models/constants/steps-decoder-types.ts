/**
 * The shape of `steps_motion_decoder_2_0_0`'s dequantisation table — types only, no data.
 *
 * Split out of the old `constants/client.ts` (Q-221). That file existed to give the browser bundle
 * a static JSON import, which is exactly what had to stop: the table shipped in client chunks, and
 * `_next/static` is outside `middleware.ts`'s matcher, so those chunks are served with no session.
 *
 * Types are safe to share — they describe the format, not the vendor's numbers. Keeping them here
 * lets the decoder and both injection sites agree without either of them importing the data.
 */

export interface DecoderColumnSetting {
  low: number
  high: number
  bits: number
  encode_zero?: number
}

export interface StepsDecoderConstants {
  n_features_30s: number
  n_output_features: number
  output_columns: string[]
  /** the 27 encoded input columns (base name + _1/_2/_3 group suffix) */
  data_columns: string[]
  decoder_base_settings: Record<string, DecoderColumnSetting>
  decoder_transform_settings: Record<string, { transform: string; inverse_transform: string }>
}
