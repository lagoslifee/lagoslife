import { SOCIAL, type DirectMessage, type FriendsStatus, type Notice } from "@lagos-living/shared";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";

const time = (at: string) => new Date(at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
const away = (metres: number | null) => (metres === null ? "" : metres < 1000 ? ` · ${Math.round(metres)} m away` : ` · ${(metres / 1000).toFixed(1)} km away`);

/** Phone → Friends: friend list with who's online and where, requests, and private messages. */
export function FriendsApp({ online, onToast }: { online: number; onToast: (notice: Notice) => void }) {
  const [status, setStatus] = useState<FriendsStatus | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatWith, setChatWith] = useState<string | null>(null);

  const load = useCallback(() => api.friends().then(setStatus).catch((error: Error) => onToast({ tone: "error", text: error.message })), [onToast]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const run = async (action: () => Promise<FriendsStatus>, done?: string) => {
    setBusy(true);
    try {
      setStatus(await action());
      if (done) onToast({ tone: "success", text: done });
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const userName = name.trim();
    if (userName.length < 2) return;
    setBusy(true);
    try {
      const { result, ...next } = await api.friendRequest(userName);
      setStatus(next);
      setName("");
      onToast({ tone: "success", text: result });
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (chatWith) return <Conversation userId={chatWith} onBack={() => { setChatWith(null); void load(); }} onToast={onToast} />;

  const friends = status ? [...status.friends].sort((a, b) => Number(b.online) - Number(a.online) || b.unread - a.unread || a.userName.localeCompare(b.userName)) : [];
  return (
    <div className="app-section friends-app" data-testid="friends-app">
      <p className="muted small"><strong>{online}</strong> resident{online === 1 ? "" : "s"} online near you. Tap a name in nearby chat to add them, or add a username below.</p>
      <form className="friends-add" onSubmit={add}>
        <input value={name} maxLength={40} placeholder="Username" aria-label="Friend's username" onChange={(event) => setName(event.target.value)} />
        <button className="primary" disabled={busy || name.trim().length < 2} type="submit">Add friend</button>
      </form>
      {!status && <p className="muted">Loading friends…</p>}
      {status && status.incoming.length > 0 && (
        <>
          <h4>Friend requests</h4>
          <ul className="friends-list">
            {status.incoming.map((request) => (
              <li key={request.userId} data-testid="friend-request">
                <span><strong>{request.userName}</strong> wants to be friends</span>
                <span className="friends-actions">
                  <button className="primary small" disabled={busy} onClick={() => void run(() => api.friendRespond(request.userId, true), `You and ${request.userName} are now friends.`)}>Accept</button>
                  <button className="secondary small" disabled={busy} onClick={() => void run(() => api.friendRespond(request.userId, false))}>Decline</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {status && (
        <>
          <h4>Friends ({friends.length})</h4>
          {friends.length === 0 && <p className="muted small">No friends yet. Say hi in nearby chat, then tap their name → Add friend.</p>}
          <ul className="friends-list">
            {friends.map((friend) => (
              <li key={friend.userId} data-testid="friend">
                <button className="friend-open" onClick={() => setChatWith(friend.userId)} aria-label={`Message ${friend.userName}`}>
                  <span className={`presence ${friend.online ? "on" : ""}`} aria-hidden />
                  <span>
                    <strong>{friend.userName}</strong>
                    <small className="muted">{friend.online ? `${friend.where ?? "Online"}${away(friend.distance)}` : "Offline"}</small>
                  </span>
                  {friend.unread > 0 && <span className="badge">{friend.unread}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {status && status.outgoing.length > 0 && (
        <>
          <h4>Sent requests</h4>
          <ul className="friends-list">
            {status.outgoing.map((request) => (
              <li key={request.userId}>
                <span>{request.userName}</span>
                <button className="link small" disabled={busy} onClick={() => void run(() => api.friendRemove(request.userId))}>Withdraw</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Conversation({ userId, onBack, onToast }: { userId: string; onBack: () => void; onToast: (notice: Notice) => void }) {
  const [friend, setFriend] = useState<{ userName: string; online: boolean; where: string | null } | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .messages(userId)
        .then((thread) => {
          if (!live) return;
          setFriend(thread.friend);
          setMessages(thread.messages);
        })
        .catch((error: Error) => live && onToast({ tone: "error", text: error.message }));
    void load();
    const timer = setInterval(() => void load(), 4_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [userId, onToast]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const message = await api.sendMessage(userId, text);
      setMessages((current) => [...current, message]);
      setDraft("");
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setSending(false);
    }
  };

  const remove = async () => {
    if (!friend || !confirm(`Remove ${friend.userName} from your friends?`)) return;
    try {
      await api.friendRemove(userId);
      onToast({ tone: "info", text: `${friend.userName} removed from your friends.` });
      onBack();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    }
  };

  return (
    <div className="app-section friends-chat" data-testid="friends-chat">
      <div className="friends-chat-head">
        <button className="link" onClick={onBack}>‹ Friends</button>
        <span>
          <strong>{friend?.userName ?? "…"}</strong>
          <small className="muted">{friend ? (friend.online ? friend.where ?? "Online" : "Offline") : ""}</small>
        </span>
        <button className="link small" onClick={() => void remove()}>Remove</button>
      </div>
      <ol ref={list} className="dm-lines">
        {messages.length === 0 && <li className="muted small">No messages yet. Messages are private between friends and kept for {SOCIAL.retentionDays} days.</li>}
        {messages.map((message) => (
          <li key={message.id} className={message.mine ? "mine" : ""}>
            <span>{message.text}</span>
            <time>{time(message.at)}</time>
          </li>
        ))}
      </ol>
      <form className="friends-add" onSubmit={send}>
        <input value={draft} maxLength={SOCIAL.messageMaxLength} placeholder="Message…" aria-label="Private message" onChange={(event) => setDraft(event.target.value)} />
        <button className="primary" disabled={sending || !draft.trim()} type="submit">Send</button>
      </form>
    </div>
  );
}
