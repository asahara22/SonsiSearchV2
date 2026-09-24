export type AddressResult = { kind: "url"; value: string } | { kind: "search"; value: string } | { kind: "invalid" };

export function parseAddressOrSearch(raw: string): AddressResult {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return { kind: "search", value };
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if ((url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".")) {
      if (url.username || url.password) return { kind: "invalid" };
      return { kind: "url", value: url.href };
    }
  } catch { /* Incomplete text is treated as a search query. */ }
  return { kind: "search", value };
}
