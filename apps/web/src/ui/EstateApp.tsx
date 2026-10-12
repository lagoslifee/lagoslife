import { ESTATE_AGENT, HOUSE_DESIGNS, PLOT_TERMS, agentFee, plotById, readyBuiltPrice, type Notice, type Vec2 } from "@lagos-living/shared";
import { useState } from "react";
import { api, naira, type PlotState, type PropertyListing } from "../api";

type Props = {
  properties: PropertyListing[];
  plots: PlotState[];
  here: Vec2 | null;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
  onNavigate: (target: { point: Vec2; label: string } | null) => void;
  onClose: () => void;
};

/**
 * Phone → Estate: one agent for land, ready-built houses and the flats and houses on the market. The agent buys for
 * you from anywhere for a 2% fee; walking to a plot's signboard and buying there is fee-free.
 */
export function EstateApp({ properties, plots, here, onRefresh, onToast, onNavigate, onClose }: Props) {
  const [tab, setTab] = useState<"houses" | "land" | "market">("houses");
  const [busy, setBusy] = useState(false);
  const own = plots.find((plot) => plot.status === "mine");
  const free = plots
    .filter((plot) => plot.status === "available")
    .map((plot) => ({ state: plot, plot: plotById(plot.id)! }))
    .filter((entry) => entry.plot)
    .sort((a, b) => (here ? Math.hypot(a.plot.gate[0] - here[0], a.plot.gate[1] - here[1]) - Math.hypot(b.plot.gate[0] - here[0], b.plot.gate[1] - here[1]) : 0));
  const target = own ? plotById(own.id) : free[0]?.plot;
  const ownHasHouse = Boolean(own && properties.some((listing) => listing.isMine && listing.listingType === "built"));
  const market = properties.filter((listing) => !listing.isMine && listing.available && listing.listingType !== "built");

  const run = async (work: () => Promise<string>) => {
    if (busy) return;
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
  const go = (point: Vec2, label: string) => {
    onNavigate({ point, label });
    onClose();
  };

  return (
    <div className="app-section estate-app" data-testid="estate-app">
      <div className="estate-hero">
        <strong>🏢 {ESTATE_AGENT.name}</strong>
        <small>Tell me what you want and I'll handle it from here ({Math.round(ESTATE_AGENT.feeRate * 100)}% fee), or walk to the plot's red signboard and buy there with no fee.</small>
      </div>
      <div className="place-chips" role="tablist">
        <button role="tab" aria-selected={tab === "houses"} className={tab === "houses" ? "on" : ""} onClick={() => setTab("houses")}>🏠 Houses</button>
        <button role="tab" aria-selected={tab === "land"} className={tab === "land" ? "on" : ""} onClick={() => setTab("land")}>🧱 Land & build</button>
        <button role="tab" aria-selected={tab === "market"} className={tab === "market" ? "on" : ""} onClick={() => setTab("market")}>🔑 Flats & houses {market.length || ""}</button>
      </div>

      {tab === "houses" && (
        <>
          <p className="muted small">
            {ownHasHouse
              ? "You already have a house on your plot. It's yours for good: there's nothing to list or renew."
              : target
                ? `Ready-built on ${target.name} (${target.site}), handed over at once. Pool villas and the estate mansion come with a swimming pool and more parking.`
                : "Every plot is taken right now. Check Flats & houses for homes on the market."}
          </p>
          <ul className="business-list">
            {HOUSE_DESIGNS.map((design) => {
              const price = readyBuiltPrice(design, Boolean(own));
              const fee = agentFee(price);
              return (
                <li key={design.id} className={`business-card estate-design ${design.pool ? "luxury" : ""}`}>
                  <div className="business-head">
                    <span className="business-emoji">{design.pool ? "🏝" : design.floors > 1 ? "🏡" : "🏠"}</span>
                    <div>
                      <strong>{design.name} {design.pool && <span className="estate-tag">Luxury · pool</span>}</strong>
                      <small className="muted">{design.description}</small>
                      <small>{design.bedrooms} bed · {design.floors} floor{design.floors > 1 ? "s" : ""} · {design.parking} parking · {design.width}×{design.depth} m</small>
                      <small><strong>{naira(price)}</strong>{own ? "" : " incl. freehold land"} · agent's fee {naira(fee)}</small>
                    </div>
                  </div>
                  {!ownHasHouse && target && (
                    <div className="business-actions">
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => run(async () => (await api.buyReadyBuilt(target.id, design.id, true), `The agent bought you a ${design.name} at ${target.name}. Phone → My Home to go there and furnish it.`))}
                      >
                        Buy via agent · {naira(price + fee)}
                      </button>
                      <button onClick={() => go(target.gate, `${target.name} · houses for sale`)}>See the plot</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === "land" && (
        <>
          <p className="muted small">
            Hold one plot, then build on it stage by stage (cheaper, the builders take a few minutes per stage) or buy a house ready-built. Ground rent {naira(PLOT_TERMS.leaseRent)} a week, or
            buy the freehold for {naira(PLOT_TERMS.purchasePrice)}.
          </p>
          {own ? (
            <div className="business-card">
              <strong>Your plot: {plotById(own.id)?.name}</strong>
              <div className="business-actions">
                <button className="primary" onClick={() => { const plot = plotById(own.id); if (plot) go(plot.gate, plot.name); }}>Go to your plot</button>
              </div>
              <small className="muted">At the signboard you can choose a design and pay the builders.</small>
            </div>
          ) : (
            <ul className="business-list">
              {free.slice(0, 8).map(({ plot }) => (
                <li key={plot.id} className="business-card">
                  <div className="business-head">
                    <span className="business-emoji">🧱</span>
                    <div>
                      <strong>{plot.name}</strong>
                      <small className="muted">{plot.site}{here ? ` · ${(Math.hypot(plot.gate[0] - here[0], plot.gate[1] - here[1]) / 1000).toFixed(1)} km away` : ""}</small>
                    </div>
                  </div>
                  <div className="business-actions">
                    <button className="primary" disabled={busy} onClick={() => run(async () => (await api.acquirePlot(plot.id, "owned", true), `The agent bought ${plot.name} for you. Go there to start building.`))}>
                      Buy · {naira(PLOT_TERMS.purchasePrice + agentFee(PLOT_TERMS.purchasePrice))}
                    </button>
                    <button disabled={busy} onClick={() => run(async () => (await api.acquirePlot(plot.id, "leased", true), `The agent leased ${plot.name} for you.`))}>
                      Lease · {naira(PLOT_TERMS.leaseRent + agentFee(PLOT_TERMS.leaseRent))}/wk
                    </button>
                    <button onClick={() => go(plot.gate, `${plot.name} · land for sale`)}>Visit</button>
                  </div>
                </li>
              ))}
              {free.length === 0 && <li className="muted small">Every plot is taken right now.</li>}
            </ul>
          )}
        </>
      )}

      {tab === "market" && (
        <ul className="business-list">
          {market.map((listing) => (
            <li key={listing.id} className="business-card">
              <div className="business-head">
                <span className="business-emoji">🔑</span>
                <div>
                  <strong>{listing.name}</strong>
                  <small className="muted">{listing.addressLabel}</small>
                  <small>
                    {listing.listingType !== "rental" && listing.purchasePrice > 0 ? `Buy ${naira(listing.purchasePrice)}` : ""}
                    {listing.listingType === "rental_or_sale" ? " · " : ""}
                    {listing.listingType !== "sale" && listing.rent > 0 ? `Rent ${naira(listing.rent)} every ${listing.intervalDays} days` : ""}
                  </small>
                </div>
              </div>
              <div className="business-actions">
                {listing.listingType !== "rental" && listing.purchasePrice > 0 && (
                  <button className="primary" disabled={busy} onClick={() => run(async () => (await api.acquire(listing.id, "owned"), `${listing.name} is yours. It stays yours: there's nothing to list or renew.`))}>Buy</button>
                )}
                {listing.listingType !== "sale" && listing.rent > 0 && (
                  <button disabled={busy} onClick={() => run(async () => (await api.acquire(listing.id, "rented"), `You're renting ${listing.name}.`))}>Rent</button>
                )}
                <button onClick={() => go(listing.door, `${listing.name} · view inside`)}>View inside</button>
              </div>
            </li>
          ))}
          {market.length === 0 && <li className="muted small">Nothing on the market right now.</li>}
        </ul>
      )}
    </div>
  );
}
