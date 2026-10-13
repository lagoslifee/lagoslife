import { REFERRAL, type Notice, type ReferralStatus } from "@lagos-living/shared";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";

const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;

/** Phone → Invite: a personal sign-up link, what it has earned, and a late code entry for brand-new accounts. */
export function InviteApp({ onToast, onRefresh }: { onToast: (notice: Notice) => void; onRefresh: () => void }) {
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.referral().then(setStatus).catch((error: Error) => onToast({ tone: "error", text: error.message }));
  }, [onToast]);

  if (!status) return <p className="muted">Loading your invite…</p>;
  const link = status.code ? `${location.origin}/?ref=${encodeURIComponent(status.code)}` : "";
  const message = `Come live with me in Naija World. Sign up with my link and we both get bonus naira after your first job: ${link}`;

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: "Join me in Naija World", text: message, url: link });
      else {
        await navigator.clipboard.writeText(link);
        onToast({ tone: "success", text: "Invite link copied." });
      }
    } catch {
      /* the share sheet was dismissed */
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      onToast({ tone: "success", text: "Invite link copied." });
    } catch {
      onToast({ tone: "error", text: "Copy blocked. Press and hold the link to copy it." });
    }
  };
  const claim = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.claimReferral(code);
      onToast({ tone: "success", text: `Invited by ${result.referredBy}. Finish your first job to get ${naira(result.bonus)}.` });
      setStatus(await api.referral());
      onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-section invite">
      <div className="invite-hero">
        <strong>Invite friends, earn {naira(REFERRAL.referrerBonus)} each</strong>
        <span>They get {naira(REFERRAL.newcomerBonus)} too. Both bonuses land when they finish their first job.</span>
      </div>
      {link ? (
        <>
          <p className="invite-link" data-testid="invite-link">{link}</p>
          <div className="invite-actions">
            <button className="primary" onClick={share}>Share link</button>
            <button className="secondary" onClick={copy}>Copy</button>
          </div>
        </>
      ) : (
        <p className="callout">Create a full account (Settings → Account) to get your own invite link.</p>
      )}
      <div className="invite-stats">
        <div><b>{status.invited}</b><span>joined</span></div>
        <div><b>{status.paid}</b><span>paid out</span></div>
        <div><b>{naira(status.earned)}</b><span>earned</span></div>
      </div>
      <p className="muted small">Up to {REFERRAL.maxPaidInvites} paid invites per resident.</p>
      {status.referredBy && (
        <p className="callout">
          You joined with {status.referredBy}'s invite.{" "}
          {status.bonusPending ? `Finish your first job (Phone → Jobs) to get ${naira(REFERRAL.newcomerBonus)}.` : "Your welcome bonus is paid."}
        </p>
      )}
      {status.canClaim && (
        <form className="invite-claim" onSubmit={claim}>
          <h3>Got an invite?</h3>
          <p className="muted small">New accounts can add who invited them within {REFERRAL.claimWindowHours} hours of signing up.</p>
          <div className="chat-input">
            <input value={code} onChange={(event) => setCode(event.target.value.replace(/[^A-Za-z0-9_.@]/g, ""))} placeholder="Friend's username" maxLength={30} />
            <button className="primary" disabled={busy || code.length < 3}>Add</button>
          </div>
        </form>
      )}
    </div>
  );
}
