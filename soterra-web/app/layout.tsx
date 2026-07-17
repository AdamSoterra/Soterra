import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { ReminderSync } from "./components/reminder-sync";
import { NotificationPermission } from "./components/notification-permission";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-dm",
});

export const metadata: Metadata = {
  title: "Soterra, AI project assistant for construction",
  description:
    "Soterra reads your drawings, specs and schedules so your team can find answers, book inspections and keep the project moving. Every answer cited to the source sheet.",
  appleWebApp: { capable: true, title: "Soterra", statusBarStyle: "black-translucent" },
  // favicon.ico carries 16→256px: it's what Windows uses for the taskbar/title
  // bar of the installed app, which the PNG alone wasn't covering.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0E8FE6",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={dmSans.variable}>
        <body>
          {children}
          {/* Native-app only: both no-op in a browser. */}
          <NotificationPermission />
          <ReminderSync />
        </body>
      </html>
    </ClerkProvider>
  );
}
