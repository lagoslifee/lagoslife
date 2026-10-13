import { MODERATION_ACTIONS, SONG_REQUEST, type ClubSong, type ModerationActionKind, type StaffRole } from "@lagos-living/shared";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, ApiError, modApi, naira, type Appeal, type AuditEntry, type ModReport, type ResidentRecord, type StaffOverview } from "../api";

type Tab = "reports" | "appeals" | "residents" | "audit" | "staff" | "music";

const ACTION_LABEL: Record<ModerationActionKind, string> = {
  warn: "Warn",
  mute: "Mute chat",
  suspend: "Suspend account",
  lift_mute: "Lift mute",
  lift_suspension: "Lift suspension",
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-NG") : "—");

export function ModerationConsole({ staffName }: { staffName: string }) {
  const [role, setRole] = useState<StaffRole | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("reports");
  const [overview, setOverview] = useState<StaffOverview | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [resident, setResident] = useState<ResidentRecord | null>(null);
  const [reportForAction, setReportForAction] = useState<ModReport | null>(null);

  const say = useCallback((tone: "error" | "success", text: string) => setMessage({ tone, text }), []);
  const fail = useCallback((error: unknown) => say("error", error instanceof Error ? error.message : "Something went wrong"), [say]);
  const loadOverview = useCallback(() => modApi.overview().then(setOverview).catch(fail), [fail]);

  useEffect(() => {
    api.safety().then((status) => setRole(status.role)).catch(() => setRole(null));
  }, []);
  useEffect(() => {
    if (role) void loadOverview();
  }, [role, loadOverview]);

  const openResident = useCallback(async (userId: string, report: ModReport | null = null) => {
    try {
      setResident(await modApi.resident(userId));
      setReportForAction(report);
      setTab("residents");
    } catch (error) {
      fail(error);
    }
  }, [fail]);

  if (role === undefined) return <div className="loading-screen">Checking access…</div>;
  if (!role) {
    return (
      <main className="loading-screen" data-testid="moderation-denied">
        <div className="auth-card">
          <h2>Not available</h2>
          <p className="muted">This page is only for the moderation team.</p>
          <a className="link" href="/">Back to Lagos</a>
        </div>
      </main>
    );
  }

  return (
    <main className="mod-console" data-testid="moderation-console">
      <header className="mod-header">
        <div>
          <p className="eyebrow">NAIJA WORLD · MODERATION</p>
          <h1>Signed in as {staffName} <span className="pill">{role}</span></h1>
        </div>
        {overview && (
          <dl className="mod-stats">
            <div><dt>Open reports</dt><dd data-testid="stat-open-reports">{overview.openReports}</dd></div>
            <div><dt>Pending appeals</dt><dd>{overview.pendingAppeals}</dd></div>
            <div><dt>Active mutes</dt><dd>{overview.activeMutes}</dd></div>
            <div><dt>Active suspensions</dt><dd>{overview.activeSuspensions}</dd></div>
            <div><dt>Chat lines (24 h)</dt><dd>{overview.chatLast24h}</dd></div>
          </dl>
        )}
        <a className="link" href="/">Back to the game</a>
      </header>
      <nav className="mod-tabs" role="tablist">
        {(["reports", "appeals", "residents", "audit", ...(role === "admin" ? ["staff" as const, "music" as const] : [])] as Tab[]).map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {id[0]!.toUpperCase() + id.slice(1)}
          </button>
        ))}
      </nav>
      {message && <p className={`mod-message ${message.tone}`} role="status" data-testid="mod-message">{message.text}</p>}
      {tab === "reports" && <ReportsTab onOpen={openResident} onDone={(text) => { say("success", text); void loadOverview(); }} onError={fail} />}
      {tab === "appeals" && <AppealsTab onDone={(text) => { say("success", text); void loadOverview(); }} onError={fail} />}
      {tab === "residents" && (
        <ResidentsTab
          resident={resident}
          report={reportForAction}
          onFind={async (name) => {
            try {
              setResident(await modApi.findResident(name));
              setReportForAction(null);
            } catch (error) {
              fail(error);
            }
          }}
          onActed={async (text) => {
            say("success", text);
            setReportForAction(null);
            if (resident) setResident(await modApi.resident(resident.id));
            void loadOverview();
          }}
          onError={fail}
        />
      )}
      {tab === "audit" && <AuditTab onError={fail} />}
      {tab === "music" && <MusicTab onDone={(text) => say("success", text)} onError={fail} />}
      {tab === "staff" && overview && <StaffTab overview={overview} onDone={(text) => { say("success", text); void loadOverview(); }} onError={fail} />}
    </main>
  );
}

function ReportsTab({ onOpen, onDone, onError }: { onOpen: (userId: string, report: ModReport) => void; onDone: (text: string) => void; onError: (error: unknown) => void }) {
  const [status, setStatus] = useState<"open" | "actioned" | "dismissed">("open");
  const [reports, setReports] = useState<ModReport[] | null>(null);
  const load = useCallback(() => modApi.reports(status).then(setReports).catch(onError), [status, onError]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="mod-panel">
      <div className="row">
        {(["open", "actioned", "dismissed"] as const).map((value) => (
          <button key={value} className={status === value ? "primary" : "secondary"} onClick={() => setStatus(value)}>{value}</button>
        ))}
      </div>
      {reports?.length === 0 && <p className="muted">No {status} reports.</p>}
      <ul className="mod-list">
        {reports?.map((report) => (
          <li key={report.id} data-testid="mod-report">
            <div className="row spread">
              <strong>{report.reportedName} · {report.reason}</strong>
              <span className="muted small">by {report.reporterName} · {when(report.createdAt)} · {report.openAgainst} open against them</span>
            </div>
            {report.details && <p>{report.details}</p>}
            {report.messageOriginal !== null && (
              <blockquote>
                Said: “{report.messageOriginal}”{report.messageShown !== report.messageOriginal && <span className="muted small"> (shown to players as “{report.messageShown}”)</span>} · {when(report.messageAt)}
              </blockquote>
            )}
            {report.resolutionNote && <p className="muted small">Resolution: {report.resolutionNote}</p>}
            {status === "open" && (
              <div className="row">
                <button className="primary" onClick={() => onOpen(report.reportedId, report)}>Review resident</button>
                <button
                  className="secondary"
                  onClick={async () => {
                    const note = prompt("Why dismiss this report?");
                    if (!note || note.trim().length < 3) return;
                    try {
                      await modApi.resolveReport(report.id, "dismissed", note.trim());
                      onDone("Report dismissed.");
                      void load();
                    } catch (error) {
                      onError(error);
                    }
                  }}
                >Dismiss</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResidentsTab({
  resident,
  report,
  onFind,
  onActed,
  onError,
}: {
  resident: ResidentRecord | null;
  report: ModReport | null;
  onFind: (name: string) => void;
  onActed: (text: string) => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [action, setAction] = useState<ModerationActionKind>("warn");
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState("24");
  const timed = action === "mute" || action === "suspend";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!resident) return;
    try {
      const result = await modApi.act({
        targetUserId: resident.id,
        action,
        reason: reason.trim(),
        ...(timed && hours ? { durationHours: Number(hours) } : {}),
        ...(report ? { reportId: report.id } : {}),
      });
      setReason("");
      onActed(`${ACTION_LABEL[action]} applied to ${resident.name}${result.endsAt ? ` until ${when(result.endsAt)}` : ""}. Recorded in the audit log.`);
    } catch (error) {
      onError(error instanceof ApiError ? error : new Error(String(error)));
    }
  };
  return (
    <section className="mod-panel">
      <form className="row" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onFind(name.trim()); }}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Find resident by name" aria-label="Find resident by name" />
        <button className="secondary">Find</button>
      </form>
      {resident && (
        <div className="mod-resident" data-testid="mod-resident">
          <h2>{resident.name} {resident.role && <span className="pill">{resident.role}</span>}</h2>
          <div className="mod-columns">
            <div>
              <h3>Recent chat</h3>
              {resident.chat.length === 0 && <p className="muted small">No chat on record.</p>}
              <ul className="mod-chat">
                {resident.chat.map((line) => (
                  <li key={line.id}><time>{when(line.at)}</time> {line.body}{line.filtered && <span className="pill">filtered</span>}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Sanctions</h3>
              {resident.sanctions.length === 0 && <p className="muted small">None.</p>}
              <ul className="mod-list compact">
                {resident.sanctions.map((sanction) => (
                  <li key={sanction.id}>
                    <strong>{sanction.kind}</strong> {sanction.active && <span className="pill active">active</span>} — {sanction.reason}
                    <span className="muted small"> · {when(sanction.createdAt)}{sanction.endsAt ? ` → ${when(sanction.endsAt)}` : ""}{sanction.liftedAt ? ` · lifted ${when(sanction.liftedAt)}` : ""}</span>
                  </li>
                ))}
              </ul>
              <h3>History</h3>
              <ul className="mod-list compact">
                {resident.history.map((entry) => (
                  <li key={entry.id}>{entry.action} by {entry.actorName}: {entry.reason} <span className="muted small">· {when(entry.createdAt)}</span></li>
                ))}
              </ul>
            </div>
          </div>
          <form className="mod-action" onSubmit={submit} data-testid="mod-action-form">
            <h3>Take action{report ? ` on report: ${report.reason}` : ""}</h3>
            <label>
              Action
              <select value={action} onChange={(event) => setAction(event.target.value as ModerationActionKind)}>
                {MODERATION_ACTIONS.map((value) => <option key={value} value={value}>{ACTION_LABEL[value]}</option>)}
              </select>
            </label>
            {timed && (
              <label>
                Duration (hours){action === "suspend" ? " — leave empty for no end date" : ""}
                <input type="number" min={1} max={8760} value={hours} onChange={(event) => setHours(event.target.value)} required={action === "mute"} />
              </label>
            )}
            <label>
              Reason (shown to the resident)
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required rows={2} />
            </label>
            <button className="primary" disabled={reason.trim().length < 3}>Apply {ACTION_LABEL[action].toLowerCase()}</button>
          </form>
        </div>
      )}
    </section>
  );
}

function AppealsTab({ onDone, onError }: { onDone: (text: string) => void; onError: (error: unknown) => void }) {
  const [appeals, setAppeals] = useState<Appeal[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(() => modApi.appeals().then(setAppeals).catch(onError), [onError]);
  useEffect(() => {
    void load();
  }, [load]);
  const decide = async (appeal: Appeal, outcome: "upheld" | "overturned") => {
    const note = (notes[appeal.id] ?? "").trim();
    if (note.length < 3) return onError(new Error("Write a short note explaining the decision."));
    try {
      await modApi.decideAppeal(appeal.id, outcome, note);
      onDone(`Appeal ${outcome} for ${appeal.userName}.`);
      void load();
    } catch (error) {
      onError(error);
    }
  };
  return (
    <section className="mod-panel">
      <p className="muted small">In-game justice is separate from account moderation. Upholding makes the fine payable again (at least 24 hours to pay); overturning voids it.</p>
      {appeals?.length === 0 && <p className="muted">No appeals waiting.</p>}
      <ul className="mod-list">
        {appeals?.map((appeal) => (
          <li key={appeal.id} data-testid="mod-appeal">
            <div className="row spread">
              <strong>{appeal.userName} · {appeal.title} · {naira(appeal.fine)}</strong>
              <span className="muted small">filed {when(appeal.appeal?.filedAt ?? null)}</span>
            </div>
            <p className="small">Evidence: {Math.round(appeal.evidence.speed * 3.6)} km/h measured by the server, {appeal.evidence.district ?? "unknown district"} ({Math.round(appeal.evidence.x)}, {Math.round(appeal.evidence.z)}) · issued {when(appeal.issuedAt)}</p>
            <blockquote>“{appeal.appeal?.statement}”</blockquote>
            <textarea
              rows={2}
              placeholder="Decision note (shown to the resident)"
              aria-label="Decision note"
              value={notes[appeal.id] ?? ""}
              onChange={(event) => setNotes({ ...notes, [appeal.id]: event.target.value })}
            />
            <div className="row">
              <button className="secondary" onClick={() => void decide(appeal, "upheld")}>Uphold fine</button>
              <button className="primary" onClick={() => void decide(appeal, "overturned")}>Overturn</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AuditTab({ onError }: { onError: (error: unknown) => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    modApi.audit().then(setEntries).catch(onError);
  }, [onError]);
  return (
    <section className="mod-panel">
      <p className="muted small">Every moderation action and role change, newest first. Entries cannot be edited or deleted.</p>
      <table className="mod-table" data-testid="mod-audit">
        <thead><tr><th>When</th><th>Moderator</th><th>Action</th><th>Resident</th><th>Reason</th></tr></thead>
        <tbody>
          {entries?.map((entry) => (
            <tr key={entry.id}>
              <td>{when(entry.createdAt)}</td>
              <td>{entry.actorName}</td>
              <td>{entry.action}</td>
              <td>{entry.targetName ?? "—"}</td>
              <td>{entry.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function StaffTab({ overview, onDone, onError }: { overview: StaffOverview; onDone: (text: string) => void; onError: (error: unknown) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<"moderator" | "admin" | "none">("moderator");
  const [reason, setReason] = useState("");
  return (
    <section className="mod-panel">
      <h3>Staff</h3>
      <ul className="mod-list compact">
        {overview.staff.map((member) => <li key={member.userId}><strong>{member.userName}</strong> · {member.role} · since {when(member.grantedAt)}</li>)}
      </ul>
      <form
        className="mod-action"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await modApi.setRole(name.trim(), role === "none" ? null : role, reason.trim());
            onDone(`${name.trim()} is now ${role === "none" ? "a regular resident" : role}.`);
            setName("");
            setReason("");
          } catch (error) {
            onError(error);
          }
        }}
      >
        <h3>Change a role</h3>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Resident name" aria-label="Resident name" required />
        <select value={role} onChange={(event) => setRole(event.target.value as typeof role)} aria-label="Role">
          <option value="moderator">Moderator</option>
          <option value="admin">Admin</option>
          <option value="none">No staff role</option>
        </select>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason (audited)" aria-label="Reason" minLength={3} required rows={2} />
        <button className="primary">Save role</button>
      </form>
    </section>
  );
}

/** Reads an audio file's length in the browser, so the server never has to decode uploads. */
function audioSeconds(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      Number.isFinite(probe.duration) ? resolve(probe.duration) : reject(new Error("Could not read the song's length."));
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file doesn't play as audio."));
    };
    probe.src = url;
  });
}

/** Admins upload and name the songs residents can request from club DJs. */
function MusicTab({ onDone, onError }: { onDone: (text: string) => void; onError: (error: unknown) => void }) {
  const [songs, setSongs] = useState<ClubSong[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.songs().then(setSongs).catch(onError);
  }, [onError]);
  return (
    <section className="mod-panel" data-testid="music-tab">
      <h3>Club request songs</h3>
      <p className="muted small">
        Residents tip {naira(SONG_REQUEST.tip)} to request one of these in a club; the DJ approves it and it plays for everyone there. Only upload music
        you have the rights to share. MP3, M4A, OGG or WAV, up to 12 MB and {Math.floor(SONG_REQUEST.maxSeconds / 60)} minutes.
      </p>
      <form
        className="mod-action"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!file) return;
          setBusy(true);
          try {
            const seconds = Math.round(await audioSeconds(file));
            if (seconds < SONG_REQUEST.minSeconds || seconds > SONG_REQUEST.maxSeconds) throw new Error(`Songs must be ${SONG_REQUEST.minSeconds} s to ${SONG_REQUEST.maxSeconds / 60} minutes long.`);
            const song = await api.uploadSong(file, { title: title.trim(), artist: artist.trim(), seconds });
            setSongs((list) => [song, ...(list ?? [])]);
            onDone(`"${song.title}" is in the DJ crates.`);
            setFile(null);
            setTitle("");
            setArtist("");
            (event.target as HTMLFormElement).reset();
          } catch (error) {
            onError(error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>Upload a song</h3>
        <input
          type="file"
          accept="audio/*"
          aria-label="Song file"
          data-testid="song-file"
          required
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            setFile(chosen);
            if (chosen && !title) setTitle(chosen.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 80));
          }}
        />
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Song title" aria-label="Song title" maxLength={80} required />
        <input value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Artist" aria-label="Artist" maxLength={80} required />
        <button className="primary" disabled={busy || !file}>{busy ? "Uploading…" : "Upload song"}</button>
      </form>
      <ul className="mod-list compact" data-testid="song-list">
        {songs?.length === 0 && <li className="muted">No songs yet.</li>}
        {songs?.map((song) => (
          <li key={song.id}>
            <strong>{song.title}</strong> · {song.artist} · {Math.floor(song.seconds / 60)}:{String(song.seconds % 60).padStart(2, "0")}{" "}
            <audio controls preload="none" src={api.songUrl(song.id)} />
            <button
              className="link"
              onClick={async () => {
                try {
                  setSongs(await api.removeSong(song.id));
                  onDone(`"${song.title}" was removed.`);
                } catch (error) {
                  onError(error);
                }
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
