import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:2567";

/** A hosted build must be told where the game server lives; the localhost fallback only works on this machine. */
export const apiConfigured =
  Boolean(import.meta.env.VITE_API_URL) || ["localhost", "127.0.0.1"].includes(location.hostname);

export const authClient = createAuthClient({
  baseURL: apiUrl,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [usernameClient()],
});
