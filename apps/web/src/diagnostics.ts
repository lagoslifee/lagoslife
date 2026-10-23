import { apiUrl, authHeaders } from "./auth-client";

export type DiagnosticKind =
  | "error"
  | "rejection"
  | "context-lost"
  | "context-restored"
  | "disconnect"
  | "reconnect"
  | "low-fps"
  | "unclean-exit"
  | "memory"
  | "ui-crash";

const MAX_PER_PAGE = 25;
const RUNNING_KEY = "lagos-running";
let sent = 0;
let quality = "";
const recent = new Map<string, number>();

/** Sends one anonymised report to the server log. Never throws; repeats of the same message are dropped for a minute. */
export function report(kind: DiagnosticKind, message = "", extra: { stack?: string | undefined; detail?: Record<string, string | number | boolean | null> } = {}) {
  const key = `${kind}:${message.slice(0, 120)}`;
  const now = Date.now();
  if (sent >= MAX_PER_PAGE || now - (recent.get(key) ?? 0) < 60_000) return;
  recent.set(key, now);
  sent += 1;
  const body = {
    kind,
    message: message.slice(0, 500),
    stack: extra.stack?.slice(0, 2_000),
    detail: extra.detail,
    quality,
    device: navigator.userAgent.slice(0, 240),
    page: `${location.pathname}${area ? `#${area}` : ""}`.slice(0, 200),
  };
  void fetch(`${apiUrl}/api/diagnostics`, {
    method: "POST",
    keepalive: true,
    credentials: "include",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

export function setReportedQuality(value: string) {
  quality = value;
}

let lowSamples = 0;
let lastLowReport = 0;
/** Fed once per HUD update; reports when the frame rate stays under 15 fps for about 15 seconds. */
export function noteFps(fps: number) {
  if (document.hidden || fps <= 0) return;
  lowSamples = fps < 15 ? lowSamples + 1 : 0;
  if (lowSamples >= 15 && Date.now() - lastLowReport > 300_000) {
    lastLowReport = Date.now();
    lowSamples = 0;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    report("low-fps", `${fps} fps`, { detail: { fps, heapMb: memory ? Math.round(memory.usedJSHeapSize / 1e6) : null } });
  }
}

const CRASHED_KEY = "lagos-crashed";
let area = "";
let beatNow = () => undefined as void;

/** Which screen is showing, so a tab that dies without a word still says where it was. */
export function setArea(next: string) {
  area = next;
  beatNow();
}

/**
 * Whether a page in this tab was killed while showing (iOS does this to a tab that uses too much memory), asked once.
 * Kept in session storage because sign-in can reload the page before the game asks.
 */
export function takeCrashFlag() {
  try {
    const crashed = sessionStorage.getItem(CRASHED_KEY) === "1";
    sessionStorage.removeItem(CRASHED_KEY);
    return crashed;
  } catch {
    return false;
  }
}

/**
 * Global error hooks plus a heartbeat marker. If the previous page stopped heartbeating without a clean `pagehide`,
 * the tab was probably killed (out of memory or a browser crash) and that is reported once. Phones also discard
 * background tabs without `pagehide`, so this is a hint, not proof.
 */
export function installDiagnostics() {
  window.addEventListener("error", (event) => report("error", event.message, { stack: event.error instanceof Error ? event.error.stack : undefined }));
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    report("rejection", reason instanceof Error ? reason.message : String(reason), { stack: reason instanceof Error ? reason.stack : undefined });
  });
  try {
    const previous = JSON.parse(localStorage.getItem(RUNNING_KEY) ?? "null") as { at: number; clean: boolean; area?: string } | null;
    if (previous && !previous.clean && Date.now() - previous.at < 120_000) {
      sessionStorage.setItem(CRASHED_KEY, "1");
      report("unclean-exit", "Previous session ended without closing", { detail: { secondsAgo: Math.round((Date.now() - previous.at) / 1_000), area: previous.area ?? null } });
    }
    // Safari throws from setItem once storage is full; a heartbeat must never take a screen down with it.
    const beat = (clean: boolean) => {
      try {
        localStorage.setItem(RUNNING_KEY, JSON.stringify({ at: Date.now(), clean, area }));
      } catch {
        // The crash hint is lost, the game is not.
      }
    };
    beatNow = () => beat(false);
    beat(false);
    setInterval(() => !document.hidden && beat(false), 10_000);
    window.addEventListener("pagehide", () => beat(true));
    document.addEventListener("visibilitychange", () => beat(document.hidden));
  } catch {
    // Private browsing can refuse storage; error reports still work.
  }
}
