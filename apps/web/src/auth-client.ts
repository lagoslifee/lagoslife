import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:2567";

/** A hosted build must be told where the game server lives; the localhost fallback only works on this machine. */
export const apiConfigured =
  Boolean(import.meta.env.VITE_API_URL) || ["localhost", "127.0.0.1"].includes(location.hostname);

/**
 * Testing builds skip the sign-in page: each browser gets a throwaway guest account from the server.
 * On by default in development; `?manual=1` still opens the sign-in page.
 */
export const guestMode =
  import.meta.env.VITE_GUEST_MODE === "true" || (import.meta.env.DEV && import.meta.env.VITE_GUEST_MODE !== "false");

const TOKEN_KEY = "lagos-session-token";

/**
 * Session token sent as a header. Browsers block the server's session cookie when the web client is on another
 * site (for example `*.netlify.app`), so guest sessions travel as `Authorization: Bearer`.
 */
export const sessionToken = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export function authHeaders(): Record<string, string> {
  const token = sessionToken.get();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export const authClient = createAuthClient({
  baseURL: apiUrl,
  fetchOptions: {
    credentials: "include",
    auth: { type: "Bearer", token: () => sessionToken.get() ?? "" },
    onSuccess: ({ response }) => {
      const token = response.headers.get("set-auth-token");
      if (token) sessionToken.set(token);
    },
  },
  plugins: [usernameClient()],
});

export async function signOut() {
  sessionToken.clear();
  await authClient.signOut().catch(() => undefined);
}

export async function startGuestSession() {
  const response = await fetch(`${apiUrl}/api/guest`, { method: "POST" });
  const body = (await response.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!response.ok || !body.token) throw new Error(body.error ?? `Guest session failed (${response.status})`);
  sessionToken.set(body.token);
}
