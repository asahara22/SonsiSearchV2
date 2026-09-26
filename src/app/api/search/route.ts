// Search now opens the selected provider inside the proxy browser. This route
// intentionally remains as a small compatibility response for stale clients.
export function GET() {
  return Response.json(
    { error: "Search API is disabled. Submit a search from the SonsiSearch UI." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
