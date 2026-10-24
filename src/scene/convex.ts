import { ConvexReactClient } from "convex/react";

function createClient() {
  const url = import.meta.env.VITE_CONVEX_URL?.trim();
  if (!url) return undefined;
  try {
    return new ConvexReactClient(url);
  } catch {
    console.warn("Saved rooms are disabled: VITE_CONVEX_URL is invalid.");
    return undefined;
  }
}

export const convex = createClient();
