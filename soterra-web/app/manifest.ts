import type { MetadataRoute } from "next";

// PWA manifest — lets Soterra install to a phone home screen as a standalone app.
// start_url carries ?app=1 so the installed app opens login-first (not the marketing site).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Soterra",
    short_name: "Soterra",
    description: "Your AI site manager. Ask your plans, check the Code, run pre-inspection checks.",
    start_url: "/?app=1",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Splash background matches the app's light palette — a navy splash flashing
    // before a light app reads as a bug.
    background_color: "#F6FAFF",
    theme_color: "#0E8FE6",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
