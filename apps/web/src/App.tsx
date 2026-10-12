import {
  accessories,
  bodies,
  defaultAppearance,
  hairstyles,
  isStarterOutfit,
  outfits,
  NO_EMAIL_DOMAIN,
  PASSWORD_MIN,
  skinTones,
  starterOutfits,
  usernameSchema,
  type CharacterAppearance,
  type OutfitId,
} from "@lagos-living/shared";
import { FormEvent, lazy, Suspense, useEffect, useRef, useState } from "react";
import { LifeGoalsDialog } from "./ui/LifeGoals";
import { ACCESSORY_LABELS, BODY_LABELS, HAIR_LABELS, OUTFITS } from "./game/wardrobe";
import { apiConfigured, apiUrl, authClient, authHeaders, guestMode, sessionToken, signOut, startGuestSession } from "./auth-client";

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
        <button className="secondary" onClick={async () => { await signOut(); location.assign("/?manual=1&login=1"); }}>Sign out</button>
      </div>
    </main>
  );
}

type AuthMode = "login" | "register" | "forgot" | "reset";

/** The Naija World mark (gold tile, Lagos skyline over the lagoon) with the wordmark beside it. */
export function BrandLogo({ tagline = true }: { tagline?: boolean }) {
  return (
    <div className="brand-logo">
      <img src="/favicon.svg" alt="" width={44} height={44} />
      <span>
        <b>NAIJA WORLD</b>
        {tagline && <small>Your life · Your city · Your story</small>}
      </span>
    </div>
  );
}

function PasswordField({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string }) {
  const [shown, setShown] = useState(false);
  return (
    <label>{label}
      <span className="password-field">
        <input
          required
          minLength={PASSWORD_MIN}
          maxLength={128}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`At least ${PASSWORD_MIN} characters`}
        />
        <button type="button" className="password-toggle" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? "Hide" : "Show"}</button>
      </span>
    </label>
  );
}

const placeholderEmail = (username: string) => `${username.toLowerCase()}.${Math.random().toString(36).slice(2, 10)}@${NO_EMAIL_DOMAIN}`;

function AuthScreen() {
  const query = new URLSearchParams(location.search);
  const token = query.get("token");
  const [mode, setMode] = useState<AuthMode>(token ? "reset" : query.has("login") ? "login" : "register");
  const [email, setEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "register") {
        const checked = usernameSchema.safeParse(username);
        if (!checked.success) throw new Error("Username: 3–20 letters, numbers, _ or . (no spaces).");
        const result = await authClient.signUp.email({ email: email.trim() || placeholderEmail(username), password, name: name.trim(), username: username.trim() });
        if (result.error) throw new Error(result.error.message);
        localStorage.setItem("lagos-new-account", "1");
      } else if (mode === "login") {
        const id = identifier.trim();
        const result = id.includes("@") ? await authClient.signIn.email({ email: id, password }) : await authClient.signIn.username({ username: id.replace(/^@/, ""), password });
        if (result.error) throw new Error(result.error.message === "Invalid username or password" || /invalid/i.test(result.error.message ?? "") ? "That username/email and password don't match." : result.error.message);
      } else if (mode === "forgot") {
        const response = await fetch(`${apiUrl}/api/account/forgot`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ identifier: identifier.trim(), redirectTo: `${location.origin}/?reset=1` }),
        });
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not send the reset link.");
        setMessage("If that account has an email, a reset link is on its way. Check your inbox (and spam). It expires in 1 hour.");
      } else if (token) {
        const result = await authClient.resetPassword({ newPassword: password, token });
        if (result.error) throw new Error(result.error.message);
        history.replaceState({}, "", "/?login=1");
        setMode("login");
        setPassword("");
        setMessage("Password updated. Log in with your new password.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const playAsGuest = () => {
    setBusy(true);
    startGuestSession()
      .then(() => location.assign("/"))
      .catch((error: Error) => {
        setMessage(error.message);
        setBusy(false);
      });
  };

  const switchTo = (next: AuthMode) => {
    setMode(next);
    setMessage("");
  };
  const title = { login: "Welcome back", register: "Start your Lagos life", forgot: "Forgot your password?", reset: "Choose a new password" }[mode];
  const lead = {
    login: "Log in with your username or email.",
    register: "Create your resident in a few seconds. Your username is public; your name and email stay private.",
    forgot: "Enter your username or email. If the account has an email, we'll send a link to reset your password.",
    reset: "Pick a new password for your account.",
  }[mode];

  return (
    <main className="landing-shell">
      <section className="brand-panel">
        <BrandLogo />
        <div className="hero-copy">
          <p className="eyebrow">A LIVING LAGOS · ONLINE WITH FRIENDS</p>
          <h1>Your life. Your city.<br />Your story.</h1>
          <p>
            Build a life across the islands. Find work, buy land and build your house, drive real cars, train at the gym,
            party in VIP and fly to Dubai, all alongside real people.
          </p>
          <ul className="feature-chips">
            <li>🏡 Build your home</li><li>🚗 Real cars</li><li>💼 Run a business</li><li>🍾 VIP nights</li><li>✈️ Fly to Dubai</li>
          </ul>
        </div>
        <div className="lagoon-line" />
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit} data-testid="auth-card">
          {(mode === "login" || mode === "register") && (
            <div className="auth-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => switchTo("register")}>Sign up</button>
              <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => switchTo("login")}>Log in</button>
            </div>
          )}
          <h2>{title}</h2>
          <p className="muted">{lead}</p>
          {mode === "register" && (
            <>
              <label>Your name
                <input required maxLength={40} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Ada Obi" />
              </label>
              <label>Username
                <input
                  required
                  minLength={3}
                  maxLength={20}
                  pattern="[A-Za-z0-9_.]+"
                  title="3–20 letters, numbers, _ or ."
                  autoComplete="username"
                  autoCapitalize="none"
                  value={username}
                  onChange={(event) => setUsername(event.target.value.replace(/\s/g, ""))}
                  placeholder="e.g. IslandRunner"
                />
                <small className="field-hint">What other residents see. Letters, numbers, _ or .</small>
              </label>
            </>
          )}
          {(mode === "login" || mode === "forgot") && (
            <label>Username or email
              <input required autoComplete="username" autoCapitalize="none" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="IslandRunner or you@example.com" />
            </label>
          )}
          {mode !== "forgot" && <PasswordField label={mode === "reset" ? "New password" : "Password"} value={password} onChange={setPassword} autoComplete={mode === "login" ? "current-password" : "new-password"} />}
          {mode === "register" && (
            <label>Email <em className="optional">optional · recommended</em>
              <input type="email" autoComplete="email" maxLength={120} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
              <small className="field-hint">Only used to reset your password if you forget it. Without one, a lost password means a lost account.</small>
            </label>
          )}
          {message && <p className="form-message" role="status">{message}</p>}
          <button className="primary" disabled={busy}>
            {busy ? "Please wait…" : { login: "Enter Lagos", register: "Create account", forgot: "Send reset link", reset: "Save password" }[mode]}
          </button>
          <div className="auth-links">
            {mode === "login" && <button type="button" onClick={() => switchTo("forgot")}>Forgot password?</button>}
            {(mode === "forgot" || mode === "reset") && <button type="button" onClick={() => switchTo("login")}>Back to log in</button>}
          </div>
          {guestMode && (mode === "login" || mode === "register") && (
            <div className="guest-entry">
              <span>or</span>
              <button type="button" className="secondary" disabled={busy} onClick={playAsGuest} data-testid="play-as-guest">Play as guest</button>
              <small className="field-hint">Jump straight in. Create an account later from Phone → Settings to keep your progress.</small>
            </div>
          )}
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
  const [wearable, setWearable] = useState<readonly OutfitId[]>(() => (isStarterOutfit(initial.outfit) ? starterOutfits : [...starterOutfits, initial.outfit]));
  useEffect(() => {
    void fetch(`${apiUrl}/api/wardrobe`, { credentials: "include", headers: authHeaders() })
      .then((response) => (response.ok ? (response.json() as Promise<{ outfits: OutfitId[] }>) : null))
      .then((body) => body && setWearable(body.outfits))
      .catch(() => undefined);
  }, []);

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
    ["Body", "body", bodies, BODY_LABELS],
    ["Skin tone", "skinTone", skinTones, null],
    ["Hair", "hairstyle", hairstyles, HAIR_LABELS],
    ["Outfit", "outfit", wearable, Object.fromEntries(outfits.map((outfit) => [outfit, OUTFITS[outfit].label]))],
    ["Accessory", "accessory", accessories, ACCESSORY_LABELS],
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
          {selectors.map(([label, key, options, names]) => (
            <label key={key}>{label}
              <select
                value={appearance[key]}
                onChange={(event) =>
                  setAppearance({ ...appearance, [key]: event.target.value })
                }
              >
                {options.map((option) => (
                  <option key={option} value={option}>{(names as Record<string, string> | null)?.[option] ?? option.replaceAll("-", " ")}</option>
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
  useEffect(() => {
    const changed = (event: Event) => setAppearance((event as CustomEvent<CharacterAppearance>).detail);
    window.addEventListener("lagos-appearance", changed);
    return () => window.removeEventListener("lagos-appearance", changed);
  }, []);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(() => localStorage.getItem("lagos-new-account") === "1");
  useEffect(() => {
    const open = () => setGoalsOpen(true);
    window.addEventListener("lagos-goals", open);
    return () => window.removeEventListener("lagos-goals", open);
  }, []);
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
          overlayOpen={creatorOpen || goalsOpen}
          onCustomise={() => setCreatorOpen(true)}
          onSignOut={async () => {
            await signOut();
            location.assign("/?manual=1&login=1");
          }}
        />
      </Suspense>
      {goalsOpen && !creatorOpen && <LifeGoalsDialog playerName={playerName} onClose={() => setGoalsOpen(false)} />}
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

/** Loading text that offers a retry when the server is slow or unreachable instead of hanging forever. */
function SlowLoading({ text, offline }: { text: string; offline: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 12_000);
    return () => window.clearTimeout(timer);
  }, []);
  if (!slow && !offline) return <div className="loading-screen">{text}</div>;
  return (
    <main className="loading-screen" role="alert" data-testid="loading-slow">
      <div className="auth-card">
        <p className="step-label">{offline ? "CAN'T REACH THE GAME SERVER" : "STILL CONNECTING"}</p>
        <h2>{offline ? "The game server isn't answering" : "This is taking longer than usual"}</h2>
        <p className="muted small">Your account is saved. Check your connection, then try again.</p>
        <button onClick={() => location.reload()}>Try again</button>
      </div>
    </main>
  );
}

function ServerMissingScreen() {
  return (
    <main className="loading-screen" role="alert" data-testid="server-missing">
      <div className="auth-card">
        <p className="step-label">GAME SERVER NOT CONFIGURED</p>
        <h2>Naija World can't reach its game server</h2>
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
  const guestAttempts = useRef(0);
  const query = new URLSearchParams(location.search);
  const manual = query.has("manual") || query.has("reset") || query.has("token");
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  // Returning guests (a saved token) and `?guest=1` go straight in; new visitors see sign-up, log-in or play as guest.
  const autoGuest = guestMode && !manual && (Boolean(sessionToken.get()) || query.has("guest"));

  useEffect(() => {
    if (session.isPending || session.data || manual || autoSignIn !== "idle") return;
    // An unreachable server is not a signed-out player: keep the saved guest account and retry instead.
    if (session.error && sessionToken.get()) return;
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
    if (!autoGuest) return;
    setAutoSignIn("pending");
    startGuestSession()
      .then(() => location.assign(location.pathname))
      .catch((error: Error) => {
        // A phone switching networks or a server mid-restart usually answers a few seconds later.
        if (guestAttempts.current < 3) {
          guestAttempts.current += 1;
          setTimeout(() => setAutoSignIn("idle"), 2_500 * guestAttempts.current);
          return;
        }
        setGuestError(error.message);
        setAutoSignIn("failed");
      });
  }, [manual, local, autoGuest, autoSignIn, session.data, session.isPending]);

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
  if (session.isPending || autoSignIn === "pending" || (!session.data && autoGuest)) {
    return <SlowLoading text={local ? "Entering local test session…" : "Entering Naija World…"} offline={Boolean(session.error)} />;
  }
  return session.data ? <GameShell user={session.data.user} /> : <AuthScreen />;
}
