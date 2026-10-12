import {
  BUSINESS,
  BUSINESS_TYPES,
  businessTypeIds,
  constructionStages,
  COURSES,
  designTotal,
  HOUSE_DESIGNS,
  houseDesign,
  plotById,
  PLOT_SHOP,
  PLOT_TERMS,
  readyBuiltPrice,
  READY_BUILT_MARKUP,
  STAGE_LABELS,
  type BusinessStatus,
  type HouseDesign,
  type Notice,
} from "@lagos-living/shared";
import { useEffect, useState, type ReactNode } from "react";
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
  const [kind, setKind] = useState<"house" | "business">("house");
  const [business, setBusiness] = useState<BusinessStatus | null>(null);
  const [shopName, setShopName] = useState("");
  useEffect(() => {
    if (kind === "business" && !business) void api.business().then(setBusiness).catch(() => undefined);
  }, [kind, business]);
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

  const features = (entry: HouseDesign) =>
    [`${entry.bedrooms} bedroom${entry.bedrooms > 1 ? "s" : ""}`, `${entry.floors} floor${entry.floors > 1 ? "s" : ""}`, entry.parking ? `${entry.parking}-car carport` : "", entry.pool ? `${entry.pool[0]} × ${entry.pool[1]} m pool` : ""]
      .filter(Boolean)
      .join(" · ");

  let body: ReactNode;
  if (!state || state.status === "available") {
    body = (
      <>
        <p className="muted">Empty land, {plot.width} m × {plot.depth} m, cleared and ready for builders. Land only: no house comes with it.</p>
        <div className="choice-grid">
          <div className="choice">
            <strong>Lease the land</strong>
            <span>{naira(PLOT_TERMS.leaseRent)} every {PLOT_TERMS.leaseIntervalDays} days. Miss a payment by more than {PLOT_TERMS.leaseGraceDays} days and the land — and anything built on it — goes back on the market.</span>
            <button className="primary" disabled={busy || balance < PLOT_TERMS.leaseRent} onClick={() => ask(`Lease ${plot.name}`, PLOT_TERMS.leaseRent, async () => {
              const result = await api.acquirePlot(plot.id, "leased");
              return `${plot.name} leased. Now choose what to build on it. Balance ${naira(result.balance)}.`;
            })}>{balance < PLOT_TERMS.leaseRent ? `Need ${naira(PLOT_TERMS.leaseRent)}` : `Lease · ${naira(PLOT_TERMS.leaseRent)}/week`}</button>
          </div>
          <div className="choice">
            <strong>Buy the land</strong>
            <span>Own it outright. No rent, and your house can never be taken back.</span>
            <button className="primary" disabled={busy || balance < PLOT_TERMS.purchasePrice} onClick={() => ask(`Buy ${plot.name}`, PLOT_TERMS.purchasePrice, async () => {
              const result = await api.acquirePlot(plot.id, "owned");
              return `${plot.name} is yours. Now choose what to build on it. Balance ${naira(result.balance)}.`;
            })}>{balance < PLOT_TERMS.purchasePrice ? `Need ${naira(PLOT_TERMS.purchasePrice)}` : `Buy · ${naira(PLOT_TERMS.purchasePrice)}`}</button>
          </div>
        </div>
        <p className="muted small">The land comes empty. Once it is yours you choose what goes on it: a house, from a one-room self-contain up to a sky mansion with a helipad, or a shopfront for your business. One plot per resident.</p>
      </>
    );
  } else if (state.status === "taken") {
    body = <p className="muted">Another resident holds this land. Look for a red “For lease or sale” sign on another plot.</p>;
  } else if (state.business) {
    const spec = BUSINESS_TYPES[state.business.type];
    body = (
      <div className="choice premium" data-testid="plot-business">
        <strong>{spec.emoji} {state.business.name}</strong>
        <span>Your {spec.name.toLowerCase()} trades from this shopfront and takes {Math.round(BUSINESS.premisesBoost * 100)}% more than it would without premises.</span>
        <span className="small">Collect the takings and upgrade it in Phone → Business.</span>
      </div>
    );
  } else if (!construction) {
    const owned = new Map(business?.businesses.map((entry) => [entry.type, entry]) ?? []);
    const certified = new Set(business?.certificates ?? []);
    body = (
      <>
        <p className="muted">What do you want to build on {plot.name}?</p>
        <div className="place-chips" role="tablist">
          <button role="tab" aria-selected={kind === "house"} className={kind === "house" ? "on" : ""} onClick={() => setKind("house")} data-testid="build-house">🏠 A house</button>
          <button role="tab" aria-selected={kind === "business"} className={kind === "business" ? "on" : ""} onClick={() => setKind("business")} data-testid="build-business">🏪 A business</button>
        </div>
        {kind === "house" ? (
          <>
            <p className="muted small">Smallest to biggest. Pay the builders stage by stage (cheapest, a few minutes per stage), or pay {Math.round(READY_BUILT_MARKUP * 100)}% more and they hand over the keys today.</p>
            <div className="choice-grid">
              {HOUSE_DESIGNS.map((entry) => {
                const first = entry.stages.foundation.cost;
                const ready = readyBuiltPrice(entry);
                const minutes = constructionStages.reduce((sum, stage) => sum + entry.stages[stage].minutes, 0);
                return (
                  <div className={`choice house-choice ${entry.pool ? "premium" : ""}`} key={entry.id} data-testid={`design-${entry.id}`}>
                    <strong>{entry.helipad ? "🚁 " : ""}{entry.name}</strong>
                    <span>{entry.description}</span>
                    <span className="small">{features(entry)} · {entry.width} × {entry.depth} m</span>
                    <button className="primary" disabled={busy || balance < first} onClick={() => ask(`Start the ${entry.name}`, first, async () => {
                      const result = await api.startBuilding(plot.id, entry.id);
                      return `Builders have started the foundation. Balance ${naira(result.balance)}.`;
                    })}>{balance < first ? `Need ${naira(first)}` : `Build in stages · ${naira(first)} now, ${naira(designTotal(entry))} total · ~${minutes} min`}</button>
                    <button className="secondary" disabled={busy || balance < ready} data-testid={`ready-${entry.id}`} onClick={() => ask(`Have the builders finish the ${entry.name} today`, ready, async () => {
                      const result = await api.buyReadyBuilt(plot.id, entry.id);
                      onEnter(result.homeId);
                      onClose();
                      return `Your ${entry.name.toLowerCase()} is finished. Welcome home! Balance ${naira(result.balance)}.`;
                    })}>{balance < ready ? `Finish today · need ${naira(ready)}` : `Finish today · ${naira(ready)}`}</button>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <p className="muted small">Builders put up a shopfront ({naira(PLOT_SHOP.cost)}) and your business trades from it for {Math.round(BUSINESS.premisesBoost * 100)}% more takings. A business you already run moves in without registering again.</p>
            <label className="field">
              <span>Business name</span>
              <input value={shopName} maxLength={40} placeholder="e.g. Tobi's Place" onChange={(event) => setShopName(event.target.value)} data-testid="shop-name" />
            </label>
            {!business ? (
              <p className="muted small">Loading your businesses…</p>
            ) : (
              <div className="choice-grid">
                {businessTypeIds.map((type) => {
                  const spec = BUSINESS_TYPES[type];
                  const existing = owned.get(type);
                  const elsewhere = Boolean(existing?.plotId);
                  const missing = !existing && spec.needs && !certified.has(spec.needs) ? spec.needs : null;
                  const cost = PLOT_SHOP.cost + (existing ? 0 : spec.cost);
                  const name = existing?.name ?? shopName.trim();
                  return (
                    <div className="choice" key={type} data-testid={`shop-${type}`}>
                      <strong>{spec.emoji} {spec.name}</strong>
                      <span>{spec.blurb}</span>
                      <span className="small">{existing ? `Move ${existing.name} in · shopfront only` : `Registration ${naira(spec.cost)} + shopfront ${naira(PLOT_SHOP.cost)}`}</span>
                      <button
                        className="primary"
                        disabled={busy || elsewhere || Boolean(missing) || balance < cost || name.length < 2}
                        onClick={() => ask(`Build a ${spec.name.toLowerCase()} on ${plot.name}`, cost, async () => {
                          const result = await api.startBusiness(type, name, plot.id);
                          setBusiness(null);
                          return `${name} is open on ${plot.name}. Collect the takings in Phone → Business. Balance ${naira(result.balance)}.`;
                        })}
                      >
                        {elsewhere ? "Already has premises" : missing ? `Needs ${COURSES[missing].name}` : name.length < 2 ? "Type a name first" : balance < cost ? `Need ${naira(cost)}` : `Build · ${naira(cost)}`}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
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
