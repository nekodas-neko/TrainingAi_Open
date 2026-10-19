// Saves an image into the gallery's Pictures/TrainingAI album (#3065). Android only.
export type MediaSave = {
  isAvailable(): boolean;
  saveImage(base64: string, filename: string, mimeType: string): Promise<string>;
};
