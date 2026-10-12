import {
  accessories,
  bodies,
  defaultAppearance,
  hairColours,
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
import { ACCESSORY_LABELS, HAIR_COLOURS, HAIR_LABELS, OUTFITS, SKIN_TONE_COLOURS } from "./game/wardrobe";
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

// The session cookie is blocked when the site and game server are on different domains, so the bearer token is kept.
function enterWithToken(token: string | null | undefined) {
  if (token) sessionToken.set(token);
  location.assign("/");
}

function AuthScreen() {
  const query = new URLSearchParams(location.search);
  const token = query.get("token");
  const [mode, setMode] = useState<AuthMode>(token ? "reset" : query.has("login") ? "login" : "register");
  const [email, setEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [body, setBody] = useState<(typeof bodies)[number] | null>(null);
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
        if (!body) throw new Error("Choose woman or man so we can build your avatar.");
        const result = await authClient.signUp.email({ email: email.trim() || placeholderEmail(username), password, name: name.trim(), username: username.trim() });
        if (result.error) throw new Error(result.error.message);
        localStorage.setItem("lagos-new-account", "1");
        localStorage.setItem("lagos-new-look", "1");
        if (result.data?.token) sessionToken.set(result.data.token);
        await fetch(`${apiUrl}/api/character`, {
          method: "PUT",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify({ appearance: starterLook(body) }),
        }).catch(() => undefined);
        enterWithToken(result.data?.token);
        return;
      } else if (mode === "login") {
        const id = identifier.trim();
        const result = id.includes("@") ? await authClient.signIn.email({ email: id, password }) : await authClient.signIn.username({ username: id.replace(/^@/, ""), password });
        if (result.error) throw new Error(result.error.message === "Invalid username or password" || /invalid/i.test(result.error.message ?? "") ? "That username/email and password don't match." : result.error.message);
        enterWithToken(result.data?.token);
        return;
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
              <fieldset className="gender-choice">
                <legend>I am a</legend>
                {(["female", "male"] as const).map((option) => (
                  <button key={option} type="button" aria-pressed={body === option} onClick={() => setBody(option)}>
                    <span aria-hidden="true">{option === "female" ? "👩🏾" : "👨🏾"}</span>{option === "female" ? "Woman" : "Man"}
                  </button>
                ))}
                <small className="field-hint">Sets your avatar's body. You pick face, hair and outfit next.</small>
              </fieldset>
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

/** A first look for a new resident of the chosen body, so the avatar matches before they open the studio. */
export function starterLook(body: (typeof bodies)[number]): CharacterAppearance {
  return body === "female"
    ? { body, skinTone: "rich", hairstyle: "long", outfit: "ankara-dress", accessory: "none", hairColour: "black" }
    : { body, skinTone: "rich", hairstyle: "low-fade", outfit: "island-casual", accessory: "none", hairColour: "black" };
}

function ChipRow<T extends string>({ label, options, value, names, onPick, swatch }: {
  label: string;
  options: readonly T[];
  value: T;
  names?: Partial<Record<T, string>>;
  onPick: (value: T) => void;
  swatch?: (value: T) => string;
}) {
  return (
    <fieldset className="studio-row">
      <legend>{label}</legend>
      <div className={swatch ? "studio-swatches" : "studio-chips"}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === value}
            aria-label={names?.[option] ?? option.replaceAll("-", " ")}
            title={names?.[option] ?? option.replaceAll("-", " ")}
            onClick={() => onPick(option)}
            style={swatch ? { background: swatch(option) } : undefined}
          >
            {swatch ? null : names?.[option] ?? option.replaceAll("-", " ")}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function CharacterCreator({
  initial,
  welcome,
  onClose,
}: {
  initial: CharacterAppearance;
  welcome: boolean;
  onClose: (value?: CharacterAppearance) => void;
}) {
  const [appearance, setAppearance] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [wearable, setWearable] = useState<readonly OutfitId[]>(() => (isStarterOutfit(initial.outfit) ? starterOutfits : [...starterOutfits, initial.outfit]));
  useEffect(() => {
    void fetch(`${apiUrl}/api/wardrobe`, { credentials: "include", headers: authHeaders() })
      .then((response) => (response.ok ? (response.json() as Promise<{ outfits: OutfitId[] }>) : null))
      .then((body) => body && setWearable(body.outfits))
      .catch(() => undefined);
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    const response = await fetch(`${apiUrl}/api/character`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ appearance }),
    }).catch(() => null);
    setSaving(false);
    if (response?.ok) onClose(appearance);
    else setError("Could not save your look. Check your connection and try again.");
  }

  const set = <K extends keyof CharacterAppearance>(key: K) => (value: CharacterAppearance[K]) => setAppearance({ ...appearance, [key]: value });
  const pickBody = (body: (typeof bodies)[number]) => {
    if (body === appearance.body) return;
    const starter = starterLook(body);
    setAppearance({ ...appearance, body, hairstyle: starter.hairstyle, outfit: wearable.includes(starter.outfit) ? starter.outfit : appearance.outfit, accessory: "none" });
  };
  const outfitNames = Object.fromEntries(outfits.map((outfit) => [outfit, OUTFITS[outfit].label])) as Record<OutfitId, string>;

  return (
    <div className="modal-backdrop creator-backdrop">
      <section className="creator-card" role="dialog" aria-modal="true" aria-label="Character creator" data-testid="character-creator">
        <div className="character-preview">
          <Suspense fallback={<p className="preview-status">Loading your resident…</p>}>
            <CharacterPreview appearance={appearance} />
          </Suspense>
        </div>
        <div className="creator-options">
          <p className="step-label">{welcome ? "STEP 1 OF 2 · YOUR LOOK" : "CHARACTER STUDIO"}</p>
          <h2>{welcome ? "Choose your look" : "Make Lagos yours"}</h2>
          {welcome && <p className="muted small">This is how other residents will see you. You can change it any time from Phone → Settings.</p>}
          <ChipRow label="Body" options={bodies} value={appearance.body} names={{ female: "Woman", male: "Man" }} onPick={pickBody} />
          <ChipRow label="Skin tone" options={skinTones} value={appearance.skinTone} onPick={set("skinTone")} swatch={(tone) => SKIN_TONE_COLOURS[tone]} />
          <ChipRow label="Hairstyle" options={hairstyles} value={appearance.hairstyle} names={HAIR_LABELS} onPick={set("hairstyle")} />
          <ChipRow label="Hair colour" options={hairColours} value={appearance.hairColour ?? "black"} names={Object.fromEntries(hairColours.map((colour) => [colour, HAIR_COLOURS[colour].label]))} onPick={set("hairColour")} swatch={(colour) => HAIR_COLOURS[colour].hex} />
          <ChipRow label="Face" options={accessories} value={appearance.accessory} names={ACCESSORY_LABELS} onPick={set("accessory")} />
          <ChipRow label="Outfit" options={wearable} value={appearance.outfit} names={outfitNames} onPick={set("outfit")} />
          {error && <p className="form-message" role="status">{error}</p>}
          <div className="creator-actions">
            {!welcome && <button className="secondary" onClick={() => onClose()}>Cancel</button>}
            <button className="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : welcome ? "Looks good · next" : "Save character"}
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
  const [welcomeLook, setWelcomeLook] = useState(() => localStorage.getItem("lagos-new-look") === "1");
  const [creatorOpen, setCreatorOpen] = useState(welcomeLook);
  const [appearanceLoaded, setAppearanceLoaded] = useState(false);
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
      .catch(() => undefined)
      .finally(() => setAppearanceLoaded(true));
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
      {creatorOpen && (appearanceLoaded || !welcomeLook) && (
        <CharacterCreator
          initial={appearance}
          welcome={welcomeLook}
          onClose={(next) => {
            if (next) setAppearance(next);
            localStorage.removeItem("lagos-new-look");
            setWelcomeLook(false);
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
