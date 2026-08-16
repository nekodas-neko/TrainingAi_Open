import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// App icon — a clean diagonal dumbbell in brand green on near-black, matching the
// native Android launcher icon (android/.../mipmap-*/ic_launcher_*). No text: the
// mark reads at every size and mirrors the monochrome themed-icon cutout.
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#09090b",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      {/* Green glow */}
      <div
        style={{
          position: "absolute",
          width: 380,
          height: 380,
          borderRadius: 9999,
          background:
            "radial-gradient(circle, rgba(34,197,94,0.45), rgba(34,197,94,0) 70%)",
        }}
      />
      {/* Dumbbell (rotated) */}
      <div style={{ display: "flex", alignItems: "center", transform: "rotate(-28deg)" }}>
        <div style={{ width: 56, height: 185, background: "linear-gradient(135deg, #4ade80, #16a34a)", borderRadius: 14 }} />
        <div style={{ width: 22, height: 115, background: "#15803d", borderRadius: 6 }} />
        <div style={{ width: 160, height: 24, background: "#86efac", borderRadius: 8 }} />
        <div style={{ width: 22, height: 115, background: "#15803d", borderRadius: 6 }} />
        <div style={{ width: 56, height: 185, background: "linear-gradient(135deg, #4ade80, #16a34a)", borderRadius: 14 }} />
      </div>
    </div>,
    { ...size },
  );
}
