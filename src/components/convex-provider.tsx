"use client";

import { ConvexReactClient, ConvexProvider as Provider } from "convex/react";
import { useState } from "react";

export function ConvexProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    return url ? new ConvexReactClient(url) : null;
  });
  return client ? <Provider client={client}>{children}</Provider> : children;
}
