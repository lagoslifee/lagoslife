import { CHAT, JUSTICE, REPORT_REASONS, type ChatMessage, type Citation, type Notice, type ReportReason, type SafetyStatus } from "@lagos-living/shared";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api, naira } from "../api";

export type ReportTarget = { userName: string; message?: ChatMessage };

const REASON_LABEL: Record<ReportReason, string> = {
  harassment: "Harassment or bullying",
  hate: "Hate or slurs",
  sexual: "Sexual content",
  spam: "Spam or scams",
  cheating: "Cheating or exploits",
  impersonation: "Impersonating staff or others",
  other: "Something else",
};

const time = (at: number | string) => new Date(at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });

export function ChatPanel({
  messages,
  open,
  onOpen,
  onClose,
  onSend,
  onReport,
  onBlock,
  onFriend,
}: {
  messages: Array<ChatMessage & { own: boolean }>;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSend: (text: string) => boolean;
  onReport: (target: ReportTarget) => void;
  onBlock: (userName: string) => void;
  onFriend: (userName: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length, open]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 2_000);
    return () => clearInterval(timer);
  }, []);

  const visible = open ? messages : messages.filter(({ at }) => now - at < 30_000).slice(-6);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return onClose();
    if (!onSend(text)) return;
    setDraft("");
    onClose();
  };

  return (
    <section className={`chat-panel ${open ? "open" : ""}`} data-testid="chat-panel" aria-label="Nearby chat">
      {(open || visible.length > 0) && (
        <ol ref={list} className="chat-lines" aria-live="polite">
          {open && messages.length === 0 && <li className="muted small">Nearby chat reaches residents within {CHAT.radius} m. Be kind — chat is logged for moderation.</li>}
          {visible.map((message) => (
            <li key={message.id} className={message.own ? "own" : ""} data-testid="chat-line">
              {message.own ? (
                <b>{message.userName}</b>
              ) : (
                <button className="chat-name" onClick={() => setMenu(menu === message.id ? null : message.id)} aria-label={`Actions for ${message.userName}`}>
                  {message.userName}
                </button>
              )}
              <span>{message.text}</span>
              <time>{time(message.at)}</time>
              {menu === message.id && (
                <span className="chat-actions">
                  <button className="link small" onClick={() => { setMenu(null); onFriend(message.userName); }}>Add friend</button>
                  <button className="link small" onClick={() => { setMenu(null); onReport({ userName: message.userName, message }); }}>Report</button>
                  <button className="link small" onClick={() => { setMenu(null); onBlock(message.userName); }}>Block</button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {open ? (
        <form className="chat-input" onSubmit={submit}>
          <input
            ref={input}
            value={draft}
            maxLength={CHAT.maxLength}
            placeholder="Say something nearby…"
            aria-label="Chat message"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
              }
            }}
          />
          <button className="primary" type="submit">Send</button>
        </form>
      ) : (
        <button className="chat-open" onClick={onOpen}>💬 Chat <kbd>Enter</kbd></button>
      )}
    </section>
  );
}

export function ReportDialog({ target, onClose, onToast }: { target: ReportTarget; onClose: () => void; onToast: (notice: Notice) => void }) {
  const [reason, setReason] = useState<ReportReason>("harassment");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [alsoBlock, setAlsoBlock] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.report({ userName: target.userName, reason, details, ...(target.message ? { chatMessageId: target.message.id } : {}) });
      if (alsoBlock) await api.block(target.userName);
      onToast({
        tone: "success",
        text: result.alreadyOpen
          ? `You already have an open report about ${result.reported}. A moderator will review it.`
          : `Report sent. A moderator will review it${alsoBlock ? ", and you will no longer see their chat" : ""}.`,
      });
      onClose();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" role="dialog" aria-label={`Report ${target.userName}`} data-testid="report-dialog" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">REPORT A RESIDENT</p>
            <h2>{target.userName}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {target.message && <blockquote className="reported-line">“{target.message.text}” · {time(target.message.at)}</blockquote>}
        <label>
          Reason
          <select value={reason} onChange={(event) => setReason(event.target.value as ReportReason)}>
            {REPORT_REASONS.map((value) => <option key={value} value={value}>{REASON_LABEL[value]}</option>)}
          </select>
        </label>
        <label>
          What happened? (optional)
          <textarea value={details} maxLength={500} rows={3} onChange={(event) => setDetails(event.target.value)} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={alsoBlock} onChange={(event) => setAlsoBlock(event.target.checked)} /> Also block {target.userName}
        </label>
        <p className="muted small">Moderators see the chat line as it was sent. False reports may themselves be actioned.</p>
        <div className="row">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>Send report</button>
        </div>
      </form>
    </div>
  );
}

export function WarningNotice({ warnings, onAcknowledge }: { warnings: SafetyStatus["warnings"]; onAcknowledge: () => void }) {
  return (
    <div className="sheet-backdrop">
      <section className="sheet" role="alertdialog" aria-label="Moderator warning" data-testid="warning-notice">
        <header>
          <div>
            <p className="eyebrow">FROM THE MODERATORS</p>
            <h2>{warnings.length === 1 ? "You have a warning" : `You have ${warnings.length} warnings`}</h2>
          </div>
        </header>
        <ul className="warning-list">
          {warnings.map((warning) => <li key={warning.id}><strong>{warning.reason}</strong><span className="muted small"> · {new Date(warning.at).toLocaleString("en-NG")}</span></li>)}
        </ul>
        <p className="muted small">Further breaches of the community rules can lead to a chat mute or a suspension.</p>
        <button className="primary" onClick={onAcknowledge}>I understand</button>
      </section>
    </div>
  );
}

export function SafetyApp({ onToast, onReport }: { onToast: (notice: Notice) => void; onReport: (target: ReportTarget) => void }) {
  const [status, setStatus] = useState<SafetyStatus | null>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    api.safety().then(setStatus).catch((error: Error) => onToast({ tone: "error", text: error.message }));
  }, [onToast]);
  const run = async (work: () => Promise<SafetyStatus>, message: string) => {
    try {
      setStatus(await work());
      onToast({ tone: "success", text: message });
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    }
  };
  return (
    <div className="app-section" data-testid="safety-app">
      {status?.mutedUntil && <p className="error-text">Your chat is muted until {status.mutedUntil === "indefinitely" ? "a moderator lifts it" : new Date(status.mutedUntil).toLocaleString("en-NG")}.</p>}
      <h3>Blocked residents</h3>
      {status && status.blocked.length === 0 && <p className="muted small">Nobody. Blocking hides their chat from you and yours from them.</p>}
      <ul className="venue-list">
        {status?.blocked.map((entry) => (
          <li key={entry.userId}>
            <strong>{entry.userName}</strong>
            <button className="link" onClick={() => void run(() => api.unblock(entry.userName), `${entry.userName} unblocked.`)}>Unblock</button>
          </li>
        ))}
      </ul>
      <h3>Block or report by name</h3>
      <div className="row">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Resident name" aria-label="Resident name" maxLength={40} />
        <button className="secondary" disabled={!name.trim()} onClick={() => void run(() => api.block(name.trim()), `${name.trim()} blocked.`)}>Block</button>
        <button className="secondary" disabled={!name.trim()} onClick={() => onReport({ userName: name.trim() })}>Report</button>
      </div>
      <p className="muted small">
        Community rules: no harassment, hate, sexual content, scams or cheating, and no sharing contact details. Links, emails and phone numbers are
        hidden automatically. Moderators review every report.
      </p>
      {status?.role && (
        <p><a className="link" href="/moderation" target="_blank" rel="noreferrer" data-testid="open-moderation">Open the moderation console ({status.role})</a></p>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<Citation["status"], string> = { unpaid: "Unpaid", appealed: "Appeal under review", paid: "Paid", overturned: "Overturned on appeal" };

export function JusticeApp({ onToast, onRefresh }: { onToast: (notice: Notice) => void; onRefresh: () => Promise<void> }) {
  const [citations, setCitations] = useState<Citation[] | null>(null);
  const [appealing, setAppealing] = useState<string | null>(null);
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.citations().then(setCitations).catch((error: Error) => onToast({ tone: "error", text: error.message }));
  useEffect(() => {
    void load();
  }, []);
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      onToast({ tone: "success", text: await work() });
      await Promise.all([load(), onRefresh()]);
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="app-section" data-testid="justice-app">
      <p className="muted small">
        {JUSTICE.authority} issue citations for crashing at speed. Fines are game naira only. You can pay, or appeal once within {JUSTICE.dueHours} hours; a
        moderator decides appeals. Overdue fines stop you buying another vehicle.
      </p>
      {citations?.length === 0 && <p>No citations. Drive safely.</p>}
      <ul className="citation-list">
        {citations?.map((citation) => (
          <li key={citation.id} className={citation.status} data-testid="citation">
            <div className="row spread">
              <strong>{citation.title} · {naira(citation.fine)}</strong>
              <span className={`pill ${citation.status}`}>{STATUS_LABEL[citation.status]}</span>
            </div>
            <p className="muted small">
              {new Date(citation.issuedAt).toLocaleString("en-NG")} · {citation.evidence.district ?? "Lagos"} · measured {Math.round(citation.evidence.speed * 3.6)} km/h
            </p>
            {citation.status === "unpaid" && <p className="small">Due {new Date(citation.dueAt).toLocaleString("en-NG")}</p>}
            {citation.appeal && (
              <p className="small">
                Appeal: “{citation.appeal.statement}”{citation.appeal.outcome && <> — <strong>{citation.appeal.outcome}</strong>{citation.appeal.note ? `: ${citation.appeal.note}` : ""}</>}
              </p>
            )}
            {citation.status === "unpaid" && (
              <div className="row">
                <button className="primary" disabled={busy} onClick={() => void run(async () => {
                  const result = await api.payCitation(citation.id);
                  return `Fine paid · balance ${naira(result.balance)}.`;
                })}>Pay {naira(citation.fine)}</button>
                {!citation.appeal && new Date(citation.dueAt).getTime() > Date.now() && (
                  <button className="secondary" onClick={() => setAppealing(appealing === citation.id ? null : citation.id)}>Appeal</button>
                )}
              </div>
            )}
            {appealing === citation.id && (
              <form
                className="appeal-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await api.appealCitation(citation.id, statement);
                    setAppealing(null);
                    setStatement("");
                    return "Appeal filed. Nothing is owed until a moderator decides.";
                  });
                }}
              >
                <textarea value={statement} onChange={(event) => setStatement(event.target.value)} rows={3} minLength={10} maxLength={800} placeholder="Explain what happened (at least 10 characters)" aria-label="Appeal statement" />
                <button className="primary" disabled={busy || statement.trim().length < 10}>File appeal</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
