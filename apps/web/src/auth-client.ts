import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:2567";

export const authClient = createAuthClient({
  baseURL: apiUrl,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [usernameClient()],
});
