/**
 * What Android Back does on a sheet. A sheet that is showing a step inside itself (an editor over
 * a list) passes `onBack` to step out; Back then leaves the sheet open. Without one, Back
 * dismisses the sheet, as before.
 */
export function sheetBack(onBack: (() => void) | undefined, dismiss: () => void): () => void {
  return onBack ?? dismiss;
}
