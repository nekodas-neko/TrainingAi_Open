/** Lets one barcode through per open of the scanner; the camera reports the same code many times. */
export function createScanGate() {
  let used = false;
  return {
    take() {
      if (used) return false;
      used = true;
      return true;
    },
    reset() {
      used = false;
    },
  };
}
