import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TrainingAi",
    short_name: "TrainingAi",
    description: "AI-powered gym session tracker connected to Google Sheets",
    // PS-35b ①. Was "/session-select", which is a bare `redirect("/workout")` — so every launch
    // from the installed icon paid a redirect before showing anything. Points at the real route now.
    // Whether the Workout tab is the right place for a launch to LAND is PS-35's page-consolidation
    // question and the owner's; this only removes the hop to the same destination.
    start_url: "/workout",
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
