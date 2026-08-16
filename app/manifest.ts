import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TrainingAi",
    short_name: "TrainingAi",
    description: "AI-powered gym session tracker connected to Google Sheets",
    start_url: "/session-select",
    display: "standalone",
    orientation: "portrait",
    background_color: "#09090b",
    theme_color: "#09090b",
    categories: ["fitness", "health"],
    icons: [
      {
        src: "/icon?v=3",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon?v=3",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon?v=3",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
