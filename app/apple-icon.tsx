import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Apple touch icon — same diagonal green dumbbell as app/icon.tsx, scaled to 180.
export default function AppleIcon() {
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
      <div
        style={{
          position: "absolute",
          width: 134,
          height: 134,
          borderRadius: 9999,
          background:
            "radial-gradient(circle, rgba(34,197,94,0.45), rgba(34,197,94,0) 70%)",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", transform: "rotate(-28deg)" }}>
        <div style={{ width: 20, height: 66, background: "linear-gradient(135deg, #4ade80, #16a34a)", borderRadius: 5 }} />
        <div style={{ width: 8, height: 42, background: "#15803d", borderRadius: 2 }} />
        <div style={{ width: 56, height: 8, background: "#86efac", borderRadius: 3 }} />
        <div style={{ width: 8, height: 42, background: "#15803d", borderRadius: 2 }} />
        <div style={{ width: 20, height: 66, background: "linear-gradient(135deg, #4ade80, #16a34a)", borderRadius: 5 }} />
      </div>
    </div>,
    { ...size },
  );
}
