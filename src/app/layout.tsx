import type { Metadata, Viewport } from "next";
import { ConvexProvider } from "@/components/convex-provider";
import { AppChrome } from "@/components/app-chrome";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";
import "./browser.css";

export const metadata: Metadata = {
  title: "SonsiSearch",
  description: "検索して、見つけて、そのまま読む。",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "SonsiSearch" },
  icons: { icon: [{ url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" }], apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b1020" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" data-scroll-behavior="smooth">
      <body><ConvexProvider><AppChrome><PwaRegister />{children}</AppChrome></ConvexProvider></body>
    </html>
  );
}
