export const SCAN_IMAGE_MAX_PIXELS = 2_000_000;
export const SCAN_IMAGE_MAX_BYTES = 512 * 1024;

export class PhotoPreparationError extends Error {}

export function base64ImageBytes(value: string) {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return 0;
  }
  return (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
}

type EncodedImage = {
  bytes: number;
  read: () => Promise<string>;
  dispose: () => void;
};

export async function encodeWithinBudget(
  encode: (quality: number) => Promise<EncodedImage>,
  maxBytes: number,
) {
  for (const quality of [0.8, 0.65, 0.5, 0.35]) {
    const image = await encode(quality);
    try {
      if (!Number.isFinite(image.bytes) || image.bytes <= 0) {
        throw new PhotoPreparationError(
          'The selected photo could not be read. Try another photo.',
        );
      }
      if (image.bytes <= maxBytes) {
        const base64 = await image.read();
        if (base64ImageBytes(base64) !== image.bytes) {
          throw new PhotoPreparationError(
            'The selected photo could not be read completely. Try another photo.',
          );
        }
        return { base64, bytes: image.bytes };
      }
    } finally {
      image.dispose();
    }
  }
  throw new PhotoPreparationError(
    'This photo could not fit the upload limit. Try another photo.',
  );
}
