export function imageResize(width: number, height: number, maxEdge: number) {
  if (![width, height, maxEdge].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Invalid image dimensions.');
  }
  if (Math.max(width, height) <= maxEdge) {
    return [];
  }
  return [{ resize: width >= height ? { width: maxEdge } : { height: maxEdge } }];
}

export function imageSizeWithinPixels(width: number, height: number, maxPixels: number) {
  if (![width, height, maxPixels].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Invalid image dimensions.');
  }
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}
