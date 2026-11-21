// The picture-in-picture module as the hook test sees it: every setPhase is recorded.
export const calls: [string, { accent?: string | null } | null][] = [];
export const pictureInPicture = {
  isAvailable: () => true,
  setPhase: (phase: string, status: { accent?: string | null } | null) =>
    void calls.push([phase, status]),
  setSourceRect: () => {},
  addListener: () => ({ remove() {} }),
};
