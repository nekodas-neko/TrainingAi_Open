const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map([...ALPHABET].map((char, index) => [char, index]));

/** Characteristic values arrive base64-encoded. Malformed input yields null, never a throw. */
export function decodeBase64(value: string | null | undefined): Uint8Array | null {
  if (!value) return null;
  const text = value.replace(/=+$/, '');
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let buffer = 0;
  let index = 0;
  for (const char of text) {
    const digit = LOOKUP.get(char);
    if (digit === undefined) return null;
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}
