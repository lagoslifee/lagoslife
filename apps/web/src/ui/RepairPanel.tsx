import { useEffect, useState } from "react";
import { getPlace, REPAIR_ACTION_MS, REPAIR_LABEL, type ActiveGig, type GeneratorFault, type RepairAction } from "@lagos-living/shared";
import { api, naira } from "../api";

const PARTS: Array<{ part: GeneratorFault; icon: string; name: string; inspect: RepairAction; fix: RepairAction; fixName: string }> = [
  { part: "fuel", icon: "⛽", name: "Fuel tank", inspect: "inspect-fuel", fix: "refuel", fixName: "Refuel" },
  { part: "plug", icon: "⚡", name: "Spark plug", inspect: "inspect-plug", fix: "replace-plug", fixName: "New plug" },
  { part: "filter", icon: "🌬", name: "Air filter", inspect: "inspect-filter", fix: "clean-filter", fixName: "Clean it" },
  { part: "oil", icon: "🛢", name: "Engine oil", inspect: "inspect-oil", fix: "top-oil", fixName: "Top up" },
];

type Props = {
  gig: ActiveGig;
  /** Plays the work animation at the machine; false when the player isn't beside it. */
  onWork: (seconds: number) => boolean;
  onGig: (gig: ActiveGig) => void;
  onRunning: () => void;
  onError: (message: string) => void;
  onClose: () => void;
};

/** Hands-on generator repair: each step is a real action at the machine, checked by the server. */
export function RepairPanel({ gig, onWork, onGig, onRunning, onError, onClose }: Props) {
  const [busy, setBusy] = useState<RepairAction | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const repair = gig.repair;
  useEffect(() => {
    if (repair?.running) onRunning();
  }, [repair?.running]);
  if (!repair) return null;

  const act = (action: RepairAction) => {
    if (busy) return;
    if (!onWork(REPAIR_ACTION_MS / 1_000)) return onError("Stand beside the generator to work on it.");
    setBusy(action);
    setPending(`${REPAIR_LABEL[action]}…`);
    const started = Date.now();
    api.repairGig(action)
      .then((result) => window.setTimeout(() => onGig(result.gig), Math.max(0, REPAIR_ACTION_MS - (Date.now() - started))))
      .catch((error: Error) => onError(error.message))
      .finally(() => window.setTimeout(() => { setBusy(null); setPending(null); }, Math.max(0, REPAIR_ACTION_MS - (Date.now() - started))));
  };

  return (
    <div className="sheet-backdrop see-through" onClick={onClose}>
      <section className="sheet repair-sheet" role="dialog" aria-label="Generator repair" data-testid="repair-panel" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">🔧 GENERATOR REPAIR · {getPlace(gig.placeId).name.toUpperCase()}</p>
            <h2>{repair.running ? "It's running!" : "It won't start"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted">Pay {naira(gig.reward)} once it runs. Check parts to find the fault, fix it, then pull the cord. You can only work on a part after checking it.</p>
        <ul className="repair-parts">
          {PARTS.map(({ part, icon, name, inspect, fix, fixName }) => {
            const checked = repair.inspected.includes(part);
            return (
              <li key={part}>
                <span>{icon} {name}{checked && <small> · checked</small>}</span>
                <button className="secondary small-button" disabled={Boolean(busy) || repair.running} onClick={() => act(inspect)}>Check</button>
                <button className="secondary small-button" disabled={Boolean(busy) || repair.running || !checked} title={REPAIR_LABEL[fix]} onClick={() => act(fix)}>{fixName}</button>
              </li>
            );
          })}
        </ul>
        <button className="primary repair-start" disabled={Boolean(busy) || repair.running} onClick={() => act("pull-start")}>🪢 {REPAIR_LABEL["pull-start"]}</button>
        <ol className="repair-log" data-testid="repair-log">
          {repair.log.map((line, index) => <li key={index}>{line}</li>)}
          {pending && <li className="pending">{pending}</li>}
        </ol>
      </section>
    </div>
  );
}
