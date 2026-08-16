import sharp from 'sharp';
// gif-encoder-2 is CommonJS
// eslint-disable-next-line @typescript-eslint/no-require-imports
const GifEncoder = require('gif-encoder-2') as new (w: number, h: number) => {
  start(): void;
  finish(): void;
  setDelay(ms: number): void;
  setRepeat(n: number): void;
  setQuality(q: number): void;
  addFrame(pixels: Uint8ClampedArray): void;
  out: { getData(): Buffer };
};

const GIF_SIZE = 320; // 480→320 cuts file size by ~55%
const FRAME_COUNT = 6; // frames per direction; 8→6 cuts 25% more frames
const FRAME_DELAY_MS = 80;
const HOLD_DELAY_MS = 600;

// Find the bounding box of non-transparent pixels in a PNG.
async function getFigureBBox(
  buf: Buffer,
): Promise<{ left: number; top: number; width: number; height: number } | null> {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = new Uint8Array(data.buffer);
  let minY = info.height, maxY = -1, minX = info.width, maxX = -1;
  for (let i = 0; i < info.width * info.height; i++) {
    if (px[i * 4 + 3] > 10) {
      const y = Math.floor(i / info.width);
      const x = i % info.width;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  if (maxY < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// Crop to the figure's bounding box, scale by `scale`, then centre on a white canvas.
// Using the same `scale` for both frames eliminates zoom drift between start and end.
async function renderNormalized(
  buf: Buffer,
  bbox: { left: number; top: number; width: number; height: number },
  scale: number,
): Promise<Buffer> {
  const scaledW = Math.round(bbox.width * scale);
  const scaledH = Math.round(bbox.height * scale);
  const padL = Math.floor((GIF_SIZE - scaledW) / 2);
  const padT = Math.floor((GIF_SIZE - scaledH) / 2);
  return sharp(buf)
    .extract({ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height })
    .resize(scaledW, scaledH, { fit: 'fill' })
    .extend({
      top: padT,
      bottom: GIF_SIZE - scaledH - padT,
      left: padL,
      right: GIF_SIZE - scaledW - padL,
      background: { r: 255, g: 255, b: 255, alpha: 255 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .ensureAlpha()
    .raw()
    .toBuffer();
}

// Fallback when bbox detection fails — simple contain + white composite.
async function toRgbaOnWhite(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .resize(GIF_SIZE, GIF_SIZE, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .ensureAlpha()
    .raw()
    .toBuffer();
}

function blend(a: Buffer, b: Buffer, alpha: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i += 4) {
    out[i]     = Math.round(a[i]     * (1 - alpha) + b[i]     * alpha);
    out[i + 1] = Math.round(a[i + 1] * (1 - alpha) + b[i + 1] * alpha);
    out[i + 2] = Math.round(a[i + 2] * (1 - alpha) + b[i + 2] * alpha);
    out[i + 3] = 255;
  }
  return out;
}

export async function createExerciseGif(
  startPng: Buffer,
  endPng: Buffer,
): Promise<Buffer> {
  const [bboxStart, bboxEnd] = await Promise.all([
    getFigureBBox(startPng),
    getFigureBBox(endPng),
  ]);

  let startRaw: Buffer, endRaw: Buffer;

  if (bboxStart && bboxEnd) {
    // Compute a single scale for both frames based on the larger bounding box.
    // This makes both figures appear at the same zoom level, eliminating scale drift.
    const figW = Math.max(bboxStart.width, bboxEnd.width);
    const figH = Math.max(bboxStart.height, bboxEnd.height);
    const scale = Math.min((GIF_SIZE * 0.85) / figW, (GIF_SIZE * 0.85) / figH);
    [startRaw, endRaw] = await Promise.all([
      renderNormalized(startPng, bboxStart, scale),
      renderNormalized(endPng, bboxEnd, scale),
    ]);
  } else {
    [startRaw, endRaw] = await Promise.all([
      toRgbaOnWhite(startPng),
      toRgbaOnWhite(endPng),
    ]);
  }

  const encoder = new GifEncoder(GIF_SIZE, GIF_SIZE);
  encoder.start();
  encoder.setRepeat(0);
  encoder.setQuality(10);

  encoder.setDelay(HOLD_DELAY_MS);
  encoder.addFrame(blend(startRaw, endRaw, 0));

  encoder.setDelay(FRAME_DELAY_MS);
  for (let i = 1; i <= FRAME_COUNT; i++) {
    encoder.addFrame(blend(startRaw, endRaw, i / FRAME_COUNT));
  }

  encoder.setDelay(HOLD_DELAY_MS);
  encoder.addFrame(blend(startRaw, endRaw, 1));

  encoder.setDelay(FRAME_DELAY_MS);
  for (let i = FRAME_COUNT - 1; i >= 0; i--) {
    encoder.addFrame(blend(startRaw, endRaw, i / FRAME_COUNT));
  }

  encoder.finish();
  return encoder.out.getData();
}
