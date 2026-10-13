import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

const builtServers = [import.meta.env.VITE_API_URL, import.meta.env.VITE_API_FALLBACK_URL].filter((url): url is string => Boolean(url));

/**
 * The game server in use. An ES live binding: importers always read the current value, so when the address in use stops
 * answering and `findServer` switches to the standby one, every later request and reconnect follows it.
 */
export let apiUrl = builtServers[0] ?? "http://localhost:2567";
let servers = builtServers.length ? builtServers : [apiUrl];

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

const authBase = apiUrl;
/** The auth client is built once with the first address; its requests are sent to whichever server is in use now. */
const toCurrentServer = (url: string) => (url.startsWith(authBase) && apiUrl !== authBase ? apiUrl + url.slice(authBase.length) : url);

export const authClient = createAuthClient({
  baseURL: authBase,
  fetchOptions: {
    credentials: "include",
    auth: { type: "Bearer", token: () => sessionToken.get() ?? "" },
    customFetchImpl: (input: string | URL | Request, init?: RequestInit) => {
      if (input instanceof Request) return fetch(new Request(toCurrentServer(input.url), input), init);
      return fetch(toCurrentServer(input.toString()), init);
    },
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

async function answers(url: string, ms = 6000) {
  try {
    const response = await fetch(`${url}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(ms) });
    return response.ok;
  } catch {
    return false;
  }
}

let finding: Promise<boolean> | null = null;

/**
 * Re-reads the deployed server addresses from `/server.json` (the site lists a live address and a standby) and moves to
 * the first that answers, keeping the current one when it still does. False when none answers.
 */
export function findServer(): Promise<boolean> {
  finding ??= (async () => {
    if (builtServers.length) {
      const manifest = await fetch(`/server.json?t=${Date.now()}`, { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<{ apiUrl?: string | null; servers?: string[] }>) : null))
        .catch(() => null);
      const listed = manifest?.servers?.filter(Boolean) ?? (manifest?.apiUrl ? [manifest.apiUrl] : []);
      if (listed.length) servers = listed;
    }
    const order = servers.includes(apiUrl) ? [apiUrl, ...servers.filter((url) => url !== apiUrl)] : servers;
    const probes = order.map((url) => answers(url));
    for (const [index, probe] of probes.entries()) {
      if (await probe) {
        apiUrl = order[index]!;
        return true;
      }
    }
    return false;
  })().finally(() => {
    finding = null;
  });
  return finding;
}

/** True when a game server answers, after moving to the standby address if the one in use has gone. */
export async function serverReachable(): Promise<boolean> {
  return (await answers(apiUrl)) || findServer();
}

/** While the tab is open, check the server in use every half minute (and on return to the tab) and move off a dead one. */
export function watchServerAddress() {
  const check = () => {
    if (document.visibilityState === "visible") void serverReachable();
  };
  const timer = window.setInterval(check, 30_000);
  document.addEventListener("visibilitychange", check);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", check);
  };
}

export async function startGuestSession() {
  const response = await fetch(`${apiUrl}/api/guest`, { method: "POST" });
  const body = (await response.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!response.ok || !body.token) throw new Error(body.error ?? `Guest session failed (${response.status})`);
  sessionToken.set(body.token);
}
