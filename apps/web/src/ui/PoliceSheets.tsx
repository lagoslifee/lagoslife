import {
  OFFENCES,
  POLICE,
  ROBBERY,
  SECURITY,
  SECURITY_PLANS,
  type CheckpointStop,
  type HoldUp,
  type Notice,
  type Place,
  type PoliceCase,
  type StreetIncident,
  type RobberyRecord,
  type SecurityPlanId,
  type SecurityStatus,
} from "@lagos-living/shared";
import { useEffect, useState } from "react";
import { api, naira, type EconomyState } from "../api";

type SheetProps = {
  place: Place;
  economy: EconomyState | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
};

function useBusy(onToast: (notice: Notice) => void, onRefresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      onToast({ tone: "success", text: await work() });
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

const OUTCOME: Record<RobberyRecord["outcome"], string> = { robbed: "Robbed", escaped: "Got away", caught: "Stopped by police", repelled: "Chased off by guards" };

const INCIDENT: Record<StreetIncident["outcome"], string> = { paid: "You paid", drove_off: "You drove off", police: "You called the police", guards: "Your guards warned him off", ignored: "He gave up" };

export function PoliceStationSheet({ place, onClose, onRefresh, onToast, onJustice }: SheetProps & { onJustice: () => void }) {
  const [busy, run] = useBusy(onToast, onRefresh);
  const [records, setRecords] = useState<{ robberies: RobberyRecord[]; cases: PoliceCase[]; incidents: StreetIncident[] } | null>(null);
  const [accused, setAccused] = useState("");
  const [details, setDetails] = useState("");
  const load = () => api.policeRecords().then(setRecords).catch(() => undefined);
  useEffect(() => void load(), []);
  const unreported = records?.robberies.filter((record) => record.role === "victim" && record.outcome === "robbed" && !record.reported) ?? [];

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet police-sheet" role="dialog" aria-label={place.name} data-testid="police-sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">{POLICE.authority.toUpperCase()} · {place.street.toUpperCase()}</p>
            <h2>{place.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted">
          The desk sergeant takes reports of robbery. The city records every hold-up, so if your report matches, the robber is charged{" "}
          ({naira(OFFENCES.armed_robbery.fine)} fine) and has to give back what they took. Report within a day.
        </p>
        {unreported.length > 0 && (
          <p data-testid="unreported">
            On record: {unreported.map((record) => `${record.otherName} took ${naira(record.amount)}`).join("; ")}.
          </p>
        )}
        <form
          className="police-report"
          onSubmit={(event) => {
            event.preventDefault();
            const name = accused.trim();
            if (!name) return;
            void run(async () => {
              const result = await api.policeReport(name, details.trim());
              setAccused("");
              setDetails("");
              void load();
              return result.status === "charged"
                ? `${result.accused} has been charged with armed robbery.${result.restitution ? ` ${naira(result.restitution)} was returned to you.` : ""}`
                : `Report filed against ${result.accused}, but there's no record of them robbing you, so no charge was made.`;
            });
          }}
        >
          <label>
            Who robbed you?
            <input value={accused} onChange={(event) => setAccused(event.target.value)} placeholder="Resident's username" maxLength={40} data-testid="report-name" />
          </label>
          <label>
            What happened? (optional)
            <textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={500} rows={2} />
          </label>
          <button className="primary" disabled={busy || !accused.trim()} data-testid="report-submit">File report</button>
        </form>
        <button className="secondary" onClick={() => { onClose(); onJustice(); }}>Pay or contest fines (court)</button>
        {records && records.incidents.length > 0 && (
          <div className="police-records" data-testid="street-incidents">
            <h3>Roadside touts (agberos)</h3>
            <ul className="menu">
              {records.incidents.map((incident) => (
                <li key={incident.id}>
                  <div>
                    <strong>{incident.spotName}</strong>
                    <span>
                      {INCIDENT[incident.outcome]}
                      {incident.paid ? ` · ${naira(incident.paid)}` : ""}
                      {incident.dent ? " · cosmetic dent" : ""}
                      {incident.reported ? (incident.cctv ? " · reported, seen on police camera" : " · reported, no camera") : ""} · {new Date(incident.at).toLocaleString()}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {records && (records.robberies.length > 0 || records.cases.length > 0) && (
          <div className="police-records">
            <h3>Your record</h3>
            <ul className="menu">
              {records.robberies.map((record) => (
                <li key={record.id}>
                  <div>
                    <strong>{record.role === "victim" ? `Robbed by ${record.otherName}` : `You held up ${record.otherName}`}</strong>
                    <span>{OUTCOME[record.outcome]}{record.amount ? ` · ${naira(record.amount)}` : ""}{record.reported ? " · reported" : ""} · {new Date(record.at).toLocaleString()}</span>
                  </div>
                </li>
              ))}
              {records.cases.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>Case against {item.accusedName}</strong>
                    <span>{item.status === "charged" ? `Charged${item.amount ? ` · ${naira(item.amount)} recovered` : ""}` : "No record found"} · {new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

export function SecuritySheet({ place, economy, onClose, onRefresh, onToast }: SheetProps) {
  const [busy, run] = useBusy(onToast, onRefresh);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  useEffect(() => void api.security().then(setStatus).catch(() => undefined), []);
  const balance = economy?.balance ?? 0;
  const hours = SECURITY.hireMs / 3_600_000;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet security-sheet" role="dialog" aria-label={place.name} data-testid="security-sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">{place.street.toUpperCase()}</p>
            <h2>{place.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted">
          Uniformed guards for {hours} hours. They walk behind you, follow your car in a black Hilux, open your gate when you get home, and chase off
          anyone who pulls a gun on you.
        </p>
        {status?.plan && (
          <p data-testid="security-active">
            {status.guards} guards on duty until {new Date(status.until!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.{" "}
            <button className="link" disabled={busy} onClick={() => void run(async () => {
              setStatus(await api.dismissSecurity());
              return "You sent your guards home.";
            })}>Send them home</button>
          </p>
        )}
        <ul className="menu">
          {(Object.keys(SECURITY_PLANS) as SecurityPlanId[]).map((plan) => {
            const spec = SECURITY_PLANS[plan];
            return (
              <li key={plan}>
                <div>
                  <strong>{spec.label}</strong>
                  <span>{spec.guards} guards · {hours} h{balance < spec.price ? ` · need ${naira(spec.price - balance)} more` : ""}</span>
                </div>
                <div className="menu-actions">
                  <button
                    className="primary"
                    data-testid={`hire-${plan}`}
                    disabled={busy || balance < spec.price}
                    onClick={() => void run(async () => {
                      const result = await api.hireSecurity(plan);
                      setStatus(result.status);
                      return `${spec.guards} guards are with you. Balance ${naira(result.balance)}.`;
                    })}
                  >{naira(spec.price)}</button>
                </div>
              </li>
            );
          })}
        </ul>
        {status?.plan && <p className="muted small">Hiring again replaces your current guards from now.</p>}
      </section>
    </div>
  );
}

/** Y answers the first option, so drivers needn't take their hands off the keys. */
function useAnswerKey(answer: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyY" || (event.target as HTMLElement | null)?.tagName === "INPUT") return;
      event.preventDefault();
      answer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}

function useCountdown(expiresAt: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function CheckpointPrompt({ stop, onAnswer }: { stop: CheckpointStop; onAnswer: (answer: "comply" | "flee") => void }) {
  const left = useCountdown(stop.expiresAt);
  useAnswerKey(() => onAnswer("comply"));
  return (
    <section className="police-prompt" role="alertdialog" aria-label="Police checkpoint" data-testid="checkpoint">
      <p className="eyebrow">🚓 {stop.name.toUpperCase()}</p>
      <h2>"Officer, pull over. Show me your papers."</h2>
      <p className="muted small">
        Insurance and a roadworthy car pass. Without them it's a {naira(OFFENCES.no_papers.fine)} fine. Drive off and they may get your plate:{" "}
        {naira(OFFENCES.evading_checkpoint.fine)} for evading. {left}s
      </p>
      <div className="row">
        <button className="primary" onClick={() => onAnswer("comply")} data-testid="checkpoint-comply">Show papers<kbd>Y</kbd></button>
        <button className="danger" onClick={() => onAnswer("flee")} data-testid="checkpoint-flee">Drive off</button>
        <span className="muted small">or just drive away</span>
      </div>
    </section>
  );
}

export function HoldUpPrompt({ holdUp, onAnswer }: { holdUp: HoldUp; onAnswer: (answer: "comply" | "run") => void }) {
  const left = useCountdown(holdUp.expiresAt);
  useAnswerKey(() => onAnswer("comply"));
  return (
    <section className="police-prompt holdup" role="alertdialog" aria-label="Hold-up" data-testid="holdup">
      <p className="eyebrow">⚠ HOLD-UP</p>
      <h2>{holdUp.robberName} points a gun at you and demands {naira(holdUp.amount)}.</h2>
      <p className="muted small">
        Hand it over, or run with a {Math.round(ROBBERY.runEscapeChance * 100)}% chance of getting away. Either way, report it at a police station to
        get your money back. {left}s
      </p>
      <div className="row">
        <button className="primary" onClick={() => onAnswer("comply")} data-testid="holdup-comply">Hand it over<kbd>Y</kbd></button>
        <button className="danger" onClick={() => onAnswer("run")} data-testid="holdup-run">Run</button>
      </div>
    </section>
  );
}
