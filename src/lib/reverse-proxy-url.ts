/** Build an address-bar-safe route to a public HTTP(S) URL on this host. */
export function toReverseProxyPath(value: string | URL): string {
  const target = value instanceof URL ? new URL(value.href) : new URL(value);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
    throw new Error("Only credential-free HTTP(S) URLs can be opened through the proxy.");
  }
  const hash = target.hash;
  const query = target.search;
  target.hash = "";
  target.search = "";
  const encodedQuery = query ? `?__ssq=${encodeURIComponent(query)}` : "";
  return `/proxy/${target.protocol}//${target.host}${target.pathname}${encodedQuery}${hash}`;
}
