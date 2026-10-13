import { BUSINESS, BUSINESS_MARKET, BUSINESS_TYPES, COURSES, businessTypeIds, courseIds, maxAskingPrice, saleProceeds, type BusinessListing, type BusinessState, type BusinessStatus, type BusinessTypeId, type Notice } from "@lagos-living/shared";
import { useCallback, useEffect, useState } from "react";
import { api, naira } from "../api";

type Props = { onRefresh: () => Promise<void>; onToast: (notice: Notice) => void };

/** Phone → Business: register businesses, collect their takings, upgrade them, and study for certificates. */
export function BusinessApp({ onRefresh, onToast }: Props) {
  const [tab, setTab] = useState<"mine" | "start" | "market" | "school">("mine");
  const [status, setStatus] = useState<BusinessStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState<BusinessTypeId | null>(null);
  const [name, setName] = useState("");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setStatus(await api.business());
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    }
  }, [onToast]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void load();
    }, 10_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [load]);

  const run = async (work: () => Promise<string>) => {
    if (busy) return;
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

  if (!status) return <p className="muted">Loading…</p>;
  const owned = new Set(status.businesses.map((entry) => entry.type));
  const studying = status.courses.find((course) => new Date(course.endsAt).getTime() > now);
  const certified = new Set(status.certificates.concat(status.courses.filter((course) => new Date(course.endsAt).getTime() <= now).map((course) => course.course)));
  const totalPerHour = status.businesses.reduce((sum, entry) => sum + entry.perHour, 0);

  return (
    <div className="app-section business-app" data-testid="business-app">
      <div className="place-chips" role="tablist">
        <button role="tab" aria-selected={tab === "mine"} className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>My businesses {status.businesses.length || ""}</button>
        <button role="tab" aria-selected={tab === "start"} className={tab === "start" ? "on" : ""} onClick={() => setTab("start")}>Start one</button>
        <button role="tab" aria-selected={tab === "market"} className={tab === "market" ? "on" : ""} onClick={() => setTab("market")} data-testid="business-market-tab">🤝 Buy & sell</button>
        <button role="tab" aria-selected={tab === "school"} className={tab === "school" ? "on" : ""} onClick={() => setTab("school")}>🎓 School</button>
      </div>

      {tab === "mine" && (
        <>
          {status.businesses.length === 0 ? (
            <p className="muted small">You don't run a business yet. Tap <strong>Start one</strong>: a POS kiosk needs no certificate. Short of cash? Borrow from the Eko Hustle Fund in Phone → My Story.</p>
          ) : (
            <p className="muted small">Takings pile up for {BUSINESS.storeHours} hours, then stop until you collect. Together you earn {naira(totalPerHour)} an hour.</p>
          )}
          <ul className="business-list">
            {status.businesses.map((entry) => {
              const spec = BUSINESS_TYPES[entry.type];
              return (
                <li key={entry.id} className="business-card">
                  <div className="business-head">
                    <span className="business-emoji">{spec.emoji}</span>
                    <div>
                      <strong>{entry.name}</strong>
                      <small className="muted">{spec.name} · level {entry.level} · {naira(entry.perHour)}/h</small>
                    </div>
                  </div>
                  <div className="business-actions">
                    <button className="primary" disabled={busy || entry.pending <= 0} onClick={() => run(async () => `Collected ${naira((await api.collectBusiness(entry.id)).collected)} from ${entry.name}.`)}>
                      Collect {naira(entry.pending)}{entry.full ? " · full" : ""}
                    </button>
                    {entry.upgradeCost !== null ? (
                      <button disabled={busy} onClick={() => run(async () => (await api.upgradeBusiness(entry.id), `${entry.name} is now level ${entry.level + 1}.`))}>
                        Upgrade · {naira(entry.upgradeCost)}
                      </button>
                    ) : (
                      <small className="muted">Top level</small>
                    )}
                  </div>
                  <SellControls entry={entry} busy={busy} run={run} />
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === "start" && (
        <ul className="business-list">
          {businessTypeIds.map((type) => {
            const spec = BUSINESS_TYPES[type];
            const locked = spec.needs !== null && !certified.has(spec.needs);
            return (
              <li key={type} className={`business-card ${locked ? "locked" : ""}`}>
                <div className="business-head">
                  <span className="business-emoji">{spec.emoji}</span>
                  <div>
                    <strong>{spec.name}</strong>
                    <small className="muted">{spec.blurb}</small>
                    <small>Start-up {naira(spec.cost)} · earns {naira(spec.perHour)}/h at level 1</small>
                    {spec.needs && <small className={locked ? "warn" : "ok"}>{locked ? "🔒" : "✓"} Needs {COURSES[spec.needs].name}</small>}
                  </div>
                </div>
                {owned.has(type) ? (
                  <small className="muted">You run one</small>
                ) : naming === type ? (
                  <div className="business-actions">
                    <input value={name} maxLength={40} placeholder="Business name" onChange={(event) => setName(event.target.value)} />
                    <button
                      className="primary"
                      disabled={busy || name.trim().length < 2}
                      onClick={() => run(async () => {
                        await api.startBusiness(type, name.trim());
                        setNaming(null);
                        setName("");
                        setTab("mine");
                        return `${name.trim()} is open for business!`;
                      })}
                    >
                      Register
                    </button>
                  </div>
                ) : (
                  <button disabled={busy} onClick={() => (locked ? setTab("school") : (setNaming(type), setName("")))}>{locked ? "Go to school" : "Start"}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {tab === "market" && <BusinessMarket owned={owned} certified={certified} busy={busy} run={run} />}

      {tab === "school" && (
        <>
          <p className="muted small">Lagos Skills Academy (fictional). One course at a time; each takes a few minutes and gives a certificate for good.</p>
          {studying && (
            <p className="travel-flag">📖 Studying {COURSES[studying.course].name} · certificate in {Math.max(1, Math.ceil((new Date(studying.endsAt).getTime() - now) / 1000))} s</p>
          )}
          <ul className="business-list">
            {courseIds.map((course) => {
              const spec = COURSES[course];
              const done = certified.has(course);
              const current = studying?.course === course;
              return (
                <li key={course} className="business-card">
                  <div className="business-head">
                    <span className="business-emoji">{spec.emoji}</span>
                    <div>
                      <strong>{spec.name}</strong>
                      <small className="muted">{spec.perk}</small>
                      <small>{naira(spec.fee)} · {spec.minutes} min</small>
                    </div>
                  </div>
                  {done ? (
                    <small className="ok">🎓 Certified</small>
                  ) : current ? (
                    <small className="muted">In class…</small>
                  ) : (
                    <button disabled={busy || Boolean(studying)} onClick={() => run(async () => (await api.enrol(course), `Enrolled in ${spec.name}. Your certificate is ready in ${spec.minutes} minutes.`))}>
                      Enrol
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="muted small">Game roleplay with fictional game naira. Businesses are not real investments.</p>
    </div>
  );
}

type Run = (work: () => Promise<string>) => Promise<void>;

/** List a business for other residents, change or withdraw the price, or sell it straight to the brokers. */
function SellControls({ entry, busy, run }: { entry: BusinessState; busy: boolean; run: Run }) {
  const salePrice = entry.salePrice ?? null;
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(String(salePrice ?? entry.brokerOffer * 3));
  const [confirmBroker, setConfirmBroker] = useState(false);
  if (entry.plotId) return <small className="muted">Trades from your own plot, so it stays with the land.</small>;
  const asked = Math.round(Number(price.replace(/[^0-9]/g, "")) || 0);
  const cap = maxAskingPrice(entry.type, entry.level);
  const valid = asked >= BUSINESS_MARKET.minPrice && asked <= cap;
  return (
    <div className="business-sell">
      {salePrice !== null && !open && (
        <p className="travel-flag small" data-testid={`for-sale-${entry.id}`}>
          🪧 For sale at {naira(salePrice)} · you'd get {naira(saleProceeds(salePrice))} after the agent's {Math.round(BUSINESS_MARKET.agentFee * 100)}%
        </p>
      )}
      {!open ? (
        <div className="business-actions">
          <button className="link" disabled={busy} onClick={() => setOpen(true)} data-testid={`sell-${entry.id}`}>{salePrice !== null ? "Change price" : "Sell this business"}</button>
          {salePrice !== null && (
            <button className="link" disabled={busy} onClick={() => run(async () => (await api.listBusiness(entry.id, null), `${entry.name} is off the market.`))}>Take off the market</button>
          )}
        </div>
      ) : (
        <div className="business-sell-form">
          <label>
            <small>Asking price for other residents</small>
            <input inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} aria-label="Asking price" data-testid={`price-${entry.id}`} />
          </label>
          <small className="muted">
            {valid ? `Buyers pay ${naira(asked)}; you receive ${naira(saleProceeds(asked))}.` : `Between ${naira(BUSINESS_MARKET.minPrice)} and ${naira(cap)}.`}
          </small>
          <div className="business-actions">
            <button
              className="primary"
              disabled={busy || !valid}
              data-testid={`list-${entry.id}`}
              onClick={() => run(async () => {
                await api.listBusiness(entry.id, asked);
                setOpen(false);
                return `${entry.name} is listed at ${naira(asked)}. You'll be paid the moment someone buys it.`;
              })}
            >
              List for sale
            </button>
            <button disabled={busy} onClick={() => { setOpen(false); setConfirmBroker(false); }}>Cancel</button>
          </div>
          {!confirmBroker ? (
            <button className="link" disabled={busy} onClick={() => setConfirmBroker(true)}>Or sell now to Eko Business Brokers for {naira(entry.brokerOffer)}</button>
          ) : (
            <div className="business-actions">
              <button
                className="danger"
                disabled={busy}
                data-testid={`broker-${entry.id}`}
                onClick={() => run(async () => (await api.sellToBroker(entry.id), `You sold ${entry.name} to Eko Business Brokers for ${naira(entry.brokerOffer)}, plus its takings.`))}
              >
                Sell now · {naira(entry.brokerOffer)}
              </button>
              <button disabled={busy} onClick={() => setConfirmBroker(false)}>Keep it</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Businesses other residents are selling. Buying one skips the start-up and keeps its level. */
function BusinessMarket({ owned, certified, busy, run }: { owned: Set<BusinessTypeId>; certified: Set<string>; busy: boolean; run: Run }) {
  const [listings, setListings] = useState<BusinessListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.businessMarket().then(setListings).catch((failure: Error) => setError(failure.message)), []);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <p className="error-text small">{error}</p>;
  if (!listings) return <p className="muted">Loading the market…</p>;
  const others = listings.filter((entry) => !entry.mine);
  return (
    <>
      <p className="muted small">
        Running businesses for sale by other residents. You keep the level and start collecting at once; the seller pays a {Math.round(BUSINESS_MARKET.agentFee * 100)}% agent's fee.
        List your own from <strong>My businesses</strong>.
      </p>
      {others.length === 0 && <p className="muted small" data-testid="market-empty">Nothing for sale right now. Check back later, or list one of yours.</p>}
      <ul className="business-list" data-testid="business-market">
        {others.map((entry) => {
          const spec = BUSINESS_TYPES[entry.type];
          const needs = spec.needs && !certified.has(spec.needs) ? COURSES[spec.needs].name : null;
          const blocked = owned.has(entry.type) ? `You already run a ${spec.name}` : needs ? `Needs ${needs}` : owned.size >= BUSINESS.maxBusinesses ? `You run ${BUSINESS.maxBusinesses} already` : null;
          return (
            <li key={entry.id} className="business-card">
              <div className="business-head">
                <span className="business-emoji">{spec.emoji}</span>
                <div>
                  <strong>{entry.name}</strong>
                  <small className="muted">{spec.name} · level {entry.level} · about {naira(entry.perHour)}/h · from {entry.seller}</small>
                  <small>Asking {naira(entry.price)} · pays for itself in about {Math.ceil(entry.price / Math.max(1, entry.perHour))} h of takings</small>
                </div>
              </div>
              {blocked ? (
                <small className="muted">{blocked}</small>
              ) : (
                <button
                  className="primary"
                  disabled={busy}
                  data-testid={`buy-${entry.id}`}
                  onClick={() => run(async () => {
                    await api.buyBusiness(entry.id, entry.price);
                    await load();
                    return `You bought ${entry.name}! It's in My businesses, already trading.`;
                  })}
                >
                  Buy · {naira(entry.price)}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
