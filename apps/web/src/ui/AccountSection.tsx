import { PASSWORD_MIN, usernameSchema, type AccountSummary } from "@lagos-living/shared";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";

/** Settings → Account: who you are signed in as, and for guests a form to keep this progress as a real account. */
export function AccountSection({ playerName, onSignOut }: { playerName: string; onSignOut: () => void }) {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [form, setForm] = useState({ name: "", username: "", password: "", email: "" });
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void api.account().then(setAccount).catch(() => undefined);
  }, []);

  const claim = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (!usernameSchema.safeParse(form.username).success) return setMessage("Username: 3–20 letters, numbers, _ or . (no spaces).");
    setBusy(true);
    try {
      await api.claimAccount({ name: form.name.trim(), username: form.username.trim(), password: form.password, ...(form.email.trim() ? { email: form.email.trim() } : {}) });
      localStorage.setItem("lagos-new-account", "1");
      location.reload();
    } catch (error) {
      setMessage((error as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <h3>Account</h3>
      {account?.guest ? (
        <form className="claim-card" onSubmit={claim} data-testid="claim-account">
          <strong>You're playing as a guest</strong>
          <p className="muted small">Guest progress lives only in this browser. Create an account to keep your money, homes and cars, and to log in on your phone, iPad or computer.</p>
          <label>Your name
            <input required maxLength={40} autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>Username
            <input required minLength={3} maxLength={20} autoCapitalize="none" autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.replace(/\s/g, "") })} placeholder="e.g. IslandRunner" />
          </label>
          <label>Password
            <span className="password-field">
              <input required minLength={PASSWORD_MIN} maxLength={128} type={shown ? "text" : "password"} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={`At least ${PASSWORD_MIN} characters`} />
              <button type="button" className="password-toggle" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? "Hide" : "Show"}</button>
            </span>
          </label>
          <label>Email <em className="optional">optional · recommended</em>
            <input type="email" maxLength={120} autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@example.com" />
            <small className="field-hint">Only for resetting your password.</small>
          </label>
          {message && <p className="form-message" role="status">{message}</p>}
          <button className="primary" disabled={busy}>{busy ? "Saving…" : "Create account & keep progress"}</button>
        </form>
      ) : (
        <>
          <p>Signed in as <strong>{account?.username || playerName}</strong>{account?.name ? ` · ${account.name}` : ""}</p>
          {account && <p className="muted small">{account.email ? `Password resets go to ${account.email}.` : "No email on this account, so a forgotten password can't be reset. Keep your password safe."}</p>}
        </>
      )}
      <button className="secondary" onClick={() => window.dispatchEvent(new Event("lagos-goals"))}>My goals & dreams</button>
      <button className="secondary" onClick={onSignOut}>Sign out</button>
    </>
  );
}
