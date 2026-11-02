import { z } from 'zod';

// #3280. The device label and install id the app sends at sign-in. Limits mirror the CHECKs on
// `native_refresh_tokens` (device_label 1–80 chars and not blank; device_id 8–64 of [A-Za-z0-9_-]),
// so a value the table would reject is a 400 here, not a 500 after the sign-in code was spent.
// Control characters are refused: the label is printed back on another device's screen.
export const DeviceLabel = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
export const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
