import type { Metadata, Viewport } from "next";
import { AppChrome } from "@/components/app-chrome";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";
import "./browser.css";

export const metadata: Metadata = {
  title: "SonsiSearch V2",
  description: "検索して、見つけて、そのまま読む。",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "SonsiSearch V2" },
  icons: {
    icon: [
      { url: "/icons/sonsisearch-icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/sonsisearch-icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/icons/sonsisearch-apple.png",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b1020" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" data-scroll-behavior="smooth">
      <body><AppChrome><PwaRegister />{children}</AppChrome></body>
    </html>
  );
}
