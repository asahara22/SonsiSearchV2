import { BrowserShell } from "@/components/browser-shell";
import { headers } from "next/headers";

export default async function BrowserPage({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
  const { url = "" } = await searchParams;
  const requestHeaders = await headers();
  const configuredProxy = process.env.NEXT_PUBLIC_PROXY_URL?.trim();
  const host = requestHeaders.get("x-forwarded-host")?.split(",", 1)[0]?.trim() || requestHeaders.get("host") || "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const protocol = forwardedProtocol === "https" ? "https" : "http";
  let proxyOrigin = `${protocol}://${host}`;
  if (configuredProxy) {
    try {
      const configured = new URL(configuredProxy);
      if (["http:", "https:"].includes(configured.protocol)) proxyOrigin = configured.origin;
    } catch { /* Fall back to this service's public origin. */ }
  }
  return <BrowserShell initialUrl={url} proxyOrigin={proxyOrigin} />;
}
