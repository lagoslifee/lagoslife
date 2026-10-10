import {
  accessories,
  defaultAppearance,
  hairstyles,
  outfits,
  skinTones,
  type CharacterAppearance,
} from "@lagos-living/shared";
import { FormEvent, lazy, Suspense, useEffect, useState } from "react";
import { apiUrl, authClient } from "./auth-client";
import { EconomyPanel } from "./EconomyPanel";

const PlayableScene = lazy(() => import("./PlayableScene"));

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
      headers: { "content-type": "application/json" },
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
          <div className={`avatar tone-${appearance.skinTone}`}>
            <div className={`avatar-hair hair-${appearance.hairstyle}`} />
            <div className={`avatar-body outfit-${appearance.outfit}`} />
          </div>
          <p>Modular preview</p>
          <small>Final rigged character asset pending</small>
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

  useEffect(() => {
    fetch(`${apiUrl}/api/character`, { credentials: "include" })
      .then((response) => response.json())
      .then((data) => setAppearance(data.appearance ?? defaultAppearance))
      .catch(() => undefined);
  }, []);

  return (
    <main className="game-shell">
      <Suspense fallback={<div className="loading-screen">Preparing the island…</div>}>
        <PlayableScene />
      </Suspense>
      <header className="game-nav">
        <div className="wordmark"><span>LL</span> LAGOS LIVING</div>
        <div className="server-pill"><i /> DEVELOPMENT WORLD</div>
        <div className="profile-menu">
          <strong>{playerName}</strong>
          <button
            onClick={async () => {
              await authClient.signOut();
              location.assign("/?manual=1");
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <EconomyPanel />
      <aside className="location-card">
        <p className="eyebrow">CURRENT DISTRICT</p>
        <h2>Ikoyi Preview</h2>
        <p>Bourdillon–Glover starter extract · gameplay-scaled OpenStreetMap layout</p>
      </aside>
      <aside className="minimap" aria-label="Development minimap">
        <div className="map-water" />
        <div className="map-road one" /><div className="map-road two" />
        <i /><span>YOU</span>
      </aside>
      <section className="welcome-card">
        <p className="step-label">WELCOME HOME</p>
        <h1>Good evening, {playerName}.</h1>
        <p>Your journey starts here. Set your look before the city opens further.</p>
        <button className="primary" onClick={() => setCreatorOpen(true)}>Customise character</button>
      </section>
      <div className="development-notice">EARLY DEVELOPMENT · TEMPORARY WORLD ASSETS</div>
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

export function App() {
  const session = authClient.useSession();
  const [autoSignInPending, setAutoSignInPending] = useState(false);
  const manual = new URLSearchParams(location.search).has("manual");

  useEffect(() => {
    if (
      session.isPending ||
      session.data ||
      manual ||
      !["localhost", "127.0.0.1"].includes(location.hostname) ||
      sessionStorage.getItem("lagos-dev-sign-in-attempted")
    ) {
      return;
    }
    sessionStorage.setItem("lagos-dev-sign-in-attempted", "1");
    setAutoSignInPending(true);
    fetch(`${apiUrl}/api/dev/sign-in`, {
      method: "POST",
      credentials: "include",
    })
      .then((response) => {
        if (!response.ok) throw new Error("Development sign-in unavailable");
        location.reload();
      })
      .catch(() => setAutoSignInPending(false));
  }, [manual, session.data, session.isPending]);

  if (session.isPending || autoSignInPending) {
    return <div className="loading-screen">Entering local test session…</div>;
  }
  return session.data ? <GameShell user={session.data.user} /> : <AuthScreen />;
}
