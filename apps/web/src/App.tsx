import {
  accessories,
  defaultAppearance,
  hairstyles,
  outfits,
  skinTones,
  type CharacterAppearance,
} from "@lagos-living/shared";
import { FormEvent, lazy, Suspense, useEffect, useState } from "react";
import { apiConfigured, apiUrl, authClient, authHeaders, guestMode, signOut, startGuestSession } from "./auth-client";

/** After a new deploy, an open tab asks for chunk names that no longer exist; reload once to get the new build. */
function reloadOnStaleChunk<T>(load: () => Promise<T>) {
  return () =>
    load().catch((error: unknown) => {
      const key = "lagos-chunk-reload";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, String(Date.now()));
        location.reload();
        return new Promise<T>(() => undefined);
      }
      throw error;
    });
}
window.addEventListener("load", () => setTimeout(() => sessionStorage.removeItem("lagos-chunk-reload"), 10_000));

const GameView = lazy(reloadOnStaleChunk(() => import("./ui/GameView").then((module) => ({ default: module.GameView }))));
const CharacterPreview = lazy(reloadOnStaleChunk(() => import("./ui/CharacterPreview").then((module) => ({ default: module.CharacterPreview }))));
const ModerationConsole = lazy(reloadOnStaleChunk(() => import("./ui/ModerationConsole").then((module) => ({ default: module.ModerationConsole }))));

type Suspension = { reason: string; until: string | null };

function SuspendedScreen({ suspension }: { suspension: Suspension }) {
  return (
    <main className="loading-screen suspended" role="alert" data-testid="suspended-screen">
      <div className="auth-card">
        <p className="step-label">ACCOUNT SUSPENDED</p>
        <h2>You cannot enter Lagos right now</h2>
        <p>Reason given by a moderator: <strong>{suspension.reason}</strong></p>
        <p>{suspension.until ? `The suspension ends ${new Date(suspension.until).toLocaleString("en-NG")}.` : "This suspension has no end date."}</p>
        <p className="muted small">Your homes, cars and game naira are kept. If you think this is a mistake, contact the moderation team.</p>
        <button className="secondary" onClick={async () => { await signOut(); location.assign("/?manual=1"); }}>Sign out</button>
      </div>
    </main>
  );
}

type AuthMode = "login" | "register" | "forgot" | "reset";

function AuthScreen() {
  const token = new URLSearchParams(location.search).get("token");
  const [mode, setMode] = useState<AuthMode>(token ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "register") {
        const result = await authClient.signUp.email({
          email,
          password,
          name: playerName,
          username: playerName,
        });
        if (result.error) throw new Error(result.error.message);
      } else if (mode === "login") {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) throw new Error(result.error.message);
      } else if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: `${location.origin}/?reset=1`,
        });
        if (result.error) throw new Error(result.error.message);
        setMessage("If that account exists, a reset link has been sent.");
      } else if (token) {
        const result = await authClient.resetPassword({ newPassword: password, token });
        if (result.error) throw new Error(result.error.message);
        history.replaceState({}, "", "/");
        setMode("login");
        setMessage("Password updated. Sign in to continue.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const title = {
    login: "Welcome back",
    register: "Create your resident",
    forgot: "Recover your account",
    reset: "Choose a new password",
  }[mode];

  return (
    <main className="landing-shell">
      <section className="brand-panel">
        <div className="wordmark"><span>LL</span> LAGOS LIVING</div>
        <div className="hero-copy">
          <p className="eyebrow">YOUR CITY. YOUR STORY.</p>
          <h1>Live Lagos<br />your way.</h1>
          <p>
            Build a life across the islands. Find work, make a home, meet people,
            and shape a city that remembers you.
          </p>
          <div className="districts">
            <span>Ikoyi</span><span>Victoria Island</span><span>Lekki Phase 1</span>
          </div>
        </div>
        <div className="lagoon-line" />
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <p className="step-label">LAGOS LIVING / EARLY DEVELOPMENT</p>
          <h2>{title}</h2>
          <p className="muted">
            {mode === "register"
              ? "Your player name is public. Never use private personal information."
              : "Enter the city and continue your story."}
          </p>
          {mode === "register" && (
            <label>Player name
              <input
                required
                minLength={3}
                maxLength={20}
                autoComplete="username"
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="e.g. IslandRunner"
              />
            </label>
          )}
          {mode !== "reset" && (
            <label>Email
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>
          )}
          {mode !== "forgot" && (
            <label>{mode === "reset" ? "New password" : "Password"}
              <input
                required
                minLength={10}
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 10 characters"
              />
            </label>
          )}
          {message && <p className="form-message" role="status">{message}</p>}
          <button className="primary" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Enter Lagos" : mode === "register" ? "Create account" : mode === "forgot" ? "Send reset link" : "Save password"}
          </button>
          <div className="auth-links">
            {mode === "login" ? (
              <>
                <button type="button" onClick={() => setMode("register")}>Create account</button>
                <button type="button" onClick={() => setMode("forgot")}>Forgot password?</button>
              </>
            ) : (
              <button type="button" onClick={() => setMode("login")}>Back to sign in</button>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}

function CharacterCreator({
  initial,
  onClose,
}: {
  initial: CharacterAppearance;
  onClose: (value?: CharacterAppearance) => void;
}) {
  const [appearance, setAppearance] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const response = await fetch(`${apiUrl}/api/character`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ appearance }),
    });
    setSaving(false);
    if (response.ok) onClose(appearance);
  }

  const selectors = [
    ["Skin tone", "skinTone", skinTones],
    ["Hair", "hairstyle", hairstyles],
    ["Outfit", "outfit", outfits],
    ["Accessory", "accessory", accessories],
  ] as const;

  return (
    <div className="modal-backdrop">
      <section className="creator-card" role="dialog" aria-modal="true" aria-label="Character creator">
        <div className="character-preview">
          <Suspense fallback={<p className="preview-status">Loading your resident…</p>}>
            <CharacterPreview appearance={appearance} />
          </Suspense>
        </div>
        <div className="creator-options">
          <p className="step-label">CHARACTER STUDIO</p>
          <h2>Make Lagos yours</h2>
          {selectors.map(([label, key, options]) => (
            <label key={key}>{label}
              <select
                value={appearance[key]}
                onChange={(event) =>
                  setAppearance({ ...appearance, [key]: event.target.value })
                }
              >
                {options.map((option) => (
                  <option key={option} value={option}>{option.replaceAll("-", " ")}</option>
                ))}
              </select>
            </label>
          ))}
          <div className="creator-actions">
            <button className="secondary" onClick={() => onClose()}>Cancel</button>
            <button className="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save character"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function GameShell({
  user,
}: {
  user: {
    name: string;
    username?: string | null | undefined;
    displayUsername?: string | null | undefined;
  };
}) {
  const playerName = user.displayUsername ?? user.username ?? user.name;
  const [appearance, setAppearance] = useState(defaultAppearance);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [standing, setStanding] = useState<{ checked: boolean; suspension: Suspension | null }>({ checked: false, suspension: null });

  useEffect(() => {
    fetch(`${apiUrl}/api/account/standing`, { credentials: "include", headers: authHeaders() })
      .then((response) => response.json())
      .then((data: { suspension?: Suspension | null }) => setStanding({ checked: true, suspension: data.suspension ?? null }))
      .catch(() => setStanding({ checked: true, suspension: null }));
  }, []);

  useEffect(() => {
    fetch(`${apiUrl}/api/character`, { credentials: "include", headers: authHeaders() })
      .then((response) => response.json())
      .then((data) => setAppearance(data.appearance ?? defaultAppearance))
      .catch(() => undefined);
  }, []);

  if (!standing.checked) return <div className="loading-screen">Preparing Lagos…</div>;
  if (standing.suspension) return <SuspendedScreen suspension={standing.suspension} />;
  if (location.pathname === "/moderation") {
    return (
      <Suspense fallback={<div className="loading-screen">Opening the moderation console…</div>}>
        <ModerationConsole staffName={playerName} />
      </Suspense>
    );
  }

  return (
    <main className="game-shell">
      <Suspense fallback={<div className="loading-screen">Preparing Lagos…</div>}>
        <GameView
          playerName={playerName}
          appearance={appearance}
          onSuspended={(suspension) => setStanding({ checked: true, suspension })}
          overlayOpen={creatorOpen}
          onCustomise={() => setCreatorOpen(true)}
          onSignOut={async () => {
            await signOut();
            location.assign(guestMode ? "/" : "/?manual=1");
          }}
        />
      </Suspense>
      {creatorOpen && (
        <CharacterCreator
          initial={appearance}
          onClose={(next) => {
            if (next) setAppearance(next);
            setCreatorOpen(false);
          }}
        />
      )}
    </main>
  );
}

function ServerMissingScreen() {
  return (
    <main className="loading-screen" role="alert" data-testid="server-missing">
      <div className="auth-card">
        <p className="step-label">GAME SERVER NOT CONFIGURED</p>
        <h2>Lagos Living can't reach its game server</h2>
        <p>This site was built without <code>VITE_API_URL</code>, so it doesn't know where accounts and multiplayer are hosted.</p>
        <p className="muted small">Set <code>VITE_API_URL</code> to the game server's HTTPS address in the hosting environment, then rebuild.</p>
      </div>
    </main>
  );
}

export function App() {
  return apiConfigured ? <Main /> : <ServerMissingScreen />;
}

function Main() {
  const session = authClient.useSession();
  const [autoSignIn, setAutoSignIn] = useState<"idle" | "pending" | "failed">("idle");
  const [guestError, setGuestError] = useState("");
  const query = new URLSearchParams(location.search);
  const manual = query.has("manual") || query.has("reset") || query.has("token");
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);

  useEffect(() => {
    if (session.isPending || session.data || manual || autoSignIn !== "idle") return;
    const devAttempted = sessionStorage.getItem("lagos-dev-sign-in-attempted");
    if (local && !devAttempted) {
      sessionStorage.setItem("lagos-dev-sign-in-attempted", "1");
      setAutoSignIn("pending");
      fetch(`${apiUrl}/api/dev/sign-in`, { method: "POST", credentials: "include" })
        .then((response) => {
          if (!response.ok) throw new Error("Development sign-in unavailable");
          location.reload();
        })
        .catch(() => setAutoSignIn("idle"));
      return;
    }
    if (!guestMode) return;
    setAutoSignIn("pending");
    startGuestSession()
      .then(() => location.reload())
      .catch((error: Error) => {
        setGuestError(error.message);
        setAutoSignIn("failed");
      });
  }, [manual, local, autoSignIn, session.data, session.isPending]);

  if (autoSignIn === "failed") {
    return (
      <main className="loading-screen" role="alert" data-testid="guest-failed">
        <div className="auth-card">
          <p className="step-label">COULD NOT ENTER LAGOS</p>
          <h2>The game server didn't start a guest session</h2>
          <p className="muted small">{guestError}</p>
          <button onClick={() => setAutoSignIn("idle")}>Try again</button>
        </div>
      </main>
    );
  }
  if (session.isPending || autoSignIn === "pending" || (!session.data && !manual && guestMode)) {
    return <div className="loading-screen">{local ? "Entering local test session…" : "Entering Lagos as a guest…"}</div>;
  }
  return session.data ? <GameShell user={session.data.user} /> : <AuthScreen />;
}
