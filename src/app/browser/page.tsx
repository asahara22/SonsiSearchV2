import { BrowserShell } from "@/components/browser-shell";

export default async function BrowserPage({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
  const { url = "" } = await searchParams;
  return <BrowserShell key={url} initialUrl={url} />;
}
