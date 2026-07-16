import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={dmSans.variable}>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
