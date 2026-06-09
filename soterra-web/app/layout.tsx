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
  title: "Soterra — Ask your plans",
  description:
    "Ask your project's plans and specs in plain English. Get the answer in seconds, with the source sheet.",
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
