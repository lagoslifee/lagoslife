import { constructionStages, designTotal, HOUSE_DESIGNS, houseDesign, plotById, PLOT_TERMS, STAGE_LABELS, type Notice } from "@lagos-living/shared";
import { useState, type ReactNode } from "react";
import { api, naira, type EconomyState, type PlotState } from "../api";
import { buildProgress } from "../game/build-progress";

type Props = {
  plotId: string;
  state: PlotState | null;
  economy: EconomyState | null;
  now: number;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
  onEnter: (propertyId: string) => void;
};

function countdown(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

export function PlotSheet({ plotId, state, economy, now, onClose, onRefresh, onToast, onEnter }: Props) {
  const plot = plotById(plotId);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | { label: string; cost: number; work: () => Promise<string> }>(null);
  if (!plot) return null;
  const balance = economy?.balance ?? 0;
  const construction = state?.construction ?? null;
  const design = construction ? houseDesign(construction.designId) : null;

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      onToast({ tone: "success", text: await work() });
      setConfirm(null);
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const ask = (label: string, cost: number, work: () => Promise<string>) => setConfirm({ label, cost, work });

  let body: ReactNode;
  if (!state || state.status === "available") {
    body = (
      <>
        <p className="muted">Empty land, {plot.width} m × {plot.depth} m, cleared and ready for builders. Get the land first, then choose a house and pay the builders stage by stage.</p>
        <div className="choice-grid">
          <div className="choice">
            <strong>Lease the land</strong>
            <span>{naira(PLOT_TERMS.leaseRent)} every {PLOT_TERMS.leaseIntervalDays} days. Miss a payment by more than {PLOT_TERMS.leaseGraceDays} days and the land — and anything built on it — goes back on the market.</span>
            <button className="primary" disabled={busy || balance < PLOT_TERMS.leaseRent} onClick={() => ask(`Lease ${plot.name}`, PLOT_TERMS.leaseRent, async () => {
              const result = await api.acquirePlot(plot.id, "leased");
              return `${plot.name} leased. Now choose a house to build. Balance ${naira(result.balance)}.`;
            })}>{balance < PLOT_TERMS.leaseRent ? `Need ${naira(PLOT_TERMS.leaseRent)}` : `Lease · ${naira(PLOT_TERMS.leaseRent)}/week`}</button>
          </div>
          <div className="choice">
            <strong>Buy the land</strong>
            <span>Own it outright. No rent, and your house can never be taken back.</span>
            <button className="primary" disabled={busy || balance < PLOT_TERMS.purchasePrice} onClick={() => ask(`Buy ${plot.name}`, PLOT_TERMS.purchasePrice, async () => {
              const result = await api.acquirePlot(plot.id, "owned");
              return `${plot.name} is yours. Now choose a house to build. Balance ${naira(result.balance)}.`;
            })}>{balance < PLOT_TERMS.purchasePrice ? `Need ${naira(PLOT_TERMS.purchasePrice)}` : `Buy · ${naira(PLOT_TERMS.purchasePrice)}`}</button>
          </div>
        </div>
        <p className="muted small">One plot per resident. Tip: leasing leaves more money for the builders.</p>
      </>
    );
  } else if (state.status === "taken") {
    body = <p className="muted">Another resident holds this land. Look for a red “For lease or sale” sign on another plot.</p>;
  } else if (!construction) {
    body = (
      <>
        <p className="muted">Pick a house. You pay the builders one stage at a time, so you only need the first stage’s fee now.</p>
        <div className="choice-grid">
          {HOUSE_DESIGNS.map((entry) => {
            const first = entry.stages.foundation.cost;
            const minutes = constructionStages.reduce((sum, stage) => sum + entry.stages[stage].minutes, 0);
            return (
              <div className="choice" key={entry.id} data-testid={`design-${entry.id}`}>
                <strong>{entry.name}</strong>
                <span>{entry.description}</span>
                <span className="small">{entry.bedrooms} bedroom{entry.bedrooms > 1 ? "s" : ""} · {entry.floors} floor{entry.floors > 1 ? "s" : ""} · total {naira(designTotal(entry))} · about {minutes} min to build</span>
                <button className="primary" disabled={busy || balance < first} onClick={() => ask(`Start the ${entry.name}`, first, async () => {
                  const result = await api.startBuilding(plot.id, entry.id);
                  return `Builders have started the foundation. Balance ${naira(result.balance)}.`;
                })}>{balance < first ? `Need ${naira(first)}` : `Start · ${naira(first)} foundation`}</button>
              </div>
            );
          })}
        </div>
      </>
    );
  } else {
    const progress = buildProgress(construction, now);
    const nextStage = constructionStages[construction.stagesPaid];
    const nextCost = design && nextStage ? design.stages[nextStage].cost : 0;
    const remaining = Date.parse(construction.stageReadyAt) - now;
    body = (
      <>
        <ol className="stages" data-testid="build-stages">
          {constructionStages.map((stage, index) => {
            const status = construction.completed || index < progress.stage || (index === progress.stage && progress.fraction >= 1) ? "done" : index === progress.stage ? "working" : "todo";
            return (
              <li key={stage} className={status}>
                <span>{status === "done" ? "✓" : status === "working" ? "⚒" : index + 1}</span>
                <div>
                  <strong>{STAGE_LABELS[stage]}</strong>
                  <em>{design ? naira(design.stages[stage].cost) : ""}{status === "working" ? ` · ready in ${countdown(remaining)}` : status === "done" ? " · done" : ""}</em>
                  {status === "working" && <i className="stage-bar"><b style={{ width: `${Math.round(progress.fraction * 100)}%` }} /></i>}
                </div>
              </li>
            );
          })}
        </ol>
        {construction.completed ? (
          <div className="row wrap">
            <p className="success-line">Your {design?.name.toLowerCase()} is finished and set as your home.</p>
            <button className="primary" onClick={() => { onEnter(construction.homeId!); onClose(); }}>Enter your house</button>
          </div>
        ) : progress.waitingForPayment && nextStage ? (
          <div className="row wrap">
            <button className="primary" disabled={busy || balance < nextCost} onClick={() => ask(`Pay for ${STAGE_LABELS[nextStage].toLowerCase()}`, nextCost, async () => {
              const result = await api.payNextStage(plot.id);
              return `Builders started: ${STAGE_LABELS[nextStage]}. Balance ${naira(result.balance)}.`;
            })}>{balance < nextCost ? `Need ${naira(nextCost)} — do delivery jobs` : `Pay builders · ${naira(nextCost)}`}</button>
          </div>
        ) : (
          <p className="muted small">The builders are working. You can leave and come back — earn money with delivery jobs in the meantime.</p>
        )}
      </>
    );
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label={plot.name} data-testid="plot-sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">{plot.site.toUpperCase()}</p>
            <h2>{plot.name}{design ? ` · ${design.name}` : ""}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {body}
        {state?.status === "mine" && state.tenureType === "leased" && (
          <div className="lease-line">
            <span className={state.overdue ? "warning" : "muted small"}>
              Leased land · {state.overdue ? "payment overdue" : "next payment"} {state.nextPaymentAt ? new Date(state.nextPaymentAt).toLocaleDateString() : ""}
            </span>
            <button className="secondary" disabled={busy || balance < PLOT_TERMS.leaseRent} onClick={() => void run(async () => {
              const result = await api.renewPlot(plot.id);
              return `Lease paid for another ${PLOT_TERMS.leaseIntervalDays} days. Balance ${naira(result.balance)}.`;
            })}>Pay lease · {naira(PLOT_TERMS.leaseRent)}</button>
          </div>
        )}
        {confirm && (
          <div className="confirm-bar" role="alertdialog">
            <span>{confirm.label} for <strong>{naira(confirm.cost)}</strong>? Balance after: {naira(balance - confirm.cost)}</span>
            <div className="row">
              <button className="primary" disabled={busy} onClick={() => void run(confirm.work)}>Confirm</button>
              <button className="secondary" onClick={() => setConfirm(null)}>Not yet</button>
            </div>
          </div>
        )}
        <p className="muted small">Your balance: {naira(balance)}</p>
      </section>
    </div>
  );
}
