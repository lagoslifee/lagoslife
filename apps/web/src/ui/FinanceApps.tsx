import {
  BET_LIMITS,
  footballClub,
  SPIN_SEGMENTS,
  SPIN_WHEEL,
  spinSlice,
  TRADE_LIMITS,
  TRANSFER_LIMITS,
  type BettingStatus,
  type DailyStatus,
  type Fixture,
  type MarketQuote,
  type MarketStatus,
  type Notice,
  type Pick,
} from "@lagos-living/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, naira, type EconomyState } from "../api";

type MoneyProps = { economy: EconomyState | null; onRefresh: () => Promise<void>; onToast: (notice: Notice) => void };

const message = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong");
const percent = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
const units = (value: number) => value.toLocaleString("en-NG", { maximumFractionDigits: value < 1 ? 6 : 3 });

function useNow(intervalMs = 500) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function Chips({ values, onPick }: { values: number[]; onPick: (value: number) => void }) {
  return (
    <div className="category-chips">
      {values.map((value) => (
        <button key={value} className="chip" onClick={() => onPick(value)}>{value >= 1_000_000 ? `₦${value / 1_000_000}m` : `₦${value / 1_000}k`}</button>
      ))}
    </div>
  );
}

/* ---------- Daily bonus ---------- */

export function DailyBonusCard({ onRefresh, onToast, compact = false, onClaimed }: Omit<MoneyProps, "economy"> & { compact?: boolean; onClaimed?: () => void }) {
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.daily().then(setStatus).catch(() => setStatus(null));
  }, []);
  if (!status) return null;
  const claim = async () => {
    setBusy(true);
    try {
      const result = await api.claimDaily();
      onToast({ tone: "success", text: `Day ${result.streak} bonus: +${naira(result.amount)} game naira. Come back tomorrow to keep the streak.` });
      setStatus(await api.daily());
      await onRefresh();
      onClaimed?.();
    } catch (error) {
      onToast({ tone: "error", text: message(error) });
    } finally {
      setBusy(false);
    }
  };
  const day = ((status.nextStreak - 1) % status.rewards.length) + 1;
  return (
    <section className={`daily-card${compact ? " compact" : ""}`} data-testid="daily-bonus">
      <header>
        <strong>🎁 Daily bonus</strong>
        <small>{status.streak > 0 ? `${status.streak}-day streak` : "Start a streak"}</small>
      </header>
      <ol className="daily-strip">
        {status.rewards.map((amount, index) => {
          const done = status.claimedToday ? index < ((status.streak - 1) % status.rewards.length) + 1 : index < day - 1;
          const today = !status.claimedToday && index === day - 1;
          return (
            <li key={amount} className={done ? "done" : today ? "today" : ""}>
              <span>Day {index + 1}</span>
              <b>{amount >= 1_000 ? `₦${amount / 1_000}k` : naira(amount)}</b>
            </li>
          );
        })}
      </ol>
      {status.claimedToday ? (
        <p className="muted small">Collected today. Tomorrow pays {naira(status.nextAmount)} if you come back; miss a day and the streak restarts.</p>
      ) : (
        <button className="primary" disabled={busy} onClick={() => void claim()} data-testid="daily-claim">
          {busy ? "Collecting…" : `Collect ${naira(status.nextAmount)}`}
        </button>
      )}
    </section>
  );
}

/** Shown once per session on entering the city when today's bonus hasn't been collected. */
export function DailyBonusPopup({ onRefresh, onToast }: Omit<MoneyProps, "economy">) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem("lagos-daily-seen")) return;
    api.daily().then((status) => {
      if (!status.claimedToday) setOpen(true);
    }).catch(() => undefined);
  }, []);
  if (!open) return null;
  const close = () => {
    sessionStorage.setItem("lagos-daily-seen", "1");
    setOpen(false);
  };
  return (
    <div className="daily-popup" role="dialog" aria-label="Daily bonus">
      <div>
        <button className="icon-button" onClick={close} aria-label="Close daily bonus">✕</button>
        <DailyBonusCard onRefresh={onRefresh} onToast={onToast} onClaimed={() => window.setTimeout(close, 900)} />
      </div>
    </div>
  );
}

/* ---------- Bank ---------- */

function Spark({ values, up }: { values: number[]; up: boolean }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values.map((value, index) => `${((index / (values.length - 1)) * 64).toFixed(1)},${(22 - ((value - min) / (max - min || 1)) * 20).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 64 24" width="64" height="24" aria-hidden="true">
      <polyline points={points} fill="none" stroke={up ? "#1f9d63" : "#d2463b"} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function TransferForm({ onRefresh, onToast }: Omit<MoneyProps, "economy">) {
  const [userName, setUserName] = useState("");
  const [amount, setAmount] = useState(10_000);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = userName.trim().length >= 2 && amount >= TRANSFER_LIMITS.min && amount <= TRANSFER_LIMITS.max;
  const send = async () => {
    setBusy(true);
    try {
      const result = await api.transfer(userName.trim(), amount, note.trim());
      onToast({ tone: "success", text: `Sent ${naira(amount)} to ${result.to}.` });
      setConfirm(false);
      setNote("");
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: message(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bank-block">
      <h3>Send money</h3>
      <label className="field"><span>Resident's username</span><input value={userName} onChange={(event) => { setUserName(event.target.value); setConfirm(false); }} placeholder="e.g. tunde" /></label>
      <label className="field"><span>Amount (₦)</span><input type="number" inputMode="numeric" min={TRANSFER_LIMITS.min} max={TRANSFER_LIMITS.max} value={amount} onChange={(event) => { setAmount(Math.floor(Number(event.target.value))); setConfirm(false); }} /></label>
      <Chips values={[5_000, 20_000, 100_000, 1_000_000]} onPick={(value) => { setAmount(value); setConfirm(false); }} />
      <label className="field"><span>Note (optional)</span><input value={note} maxLength={80} onChange={(event) => setNote(event.target.value)} placeholder="Fuel money, rent…" /></label>
      {confirm ? (
        <div className="row">
          <button onClick={() => setConfirm(false)}>Back</button>
          <button className="primary" disabled={busy} onClick={() => void send()} data-testid="transfer-confirm">{busy ? "Sending…" : `Confirm: send ${naira(amount)} to ${userName.trim()}`}</button>
        </div>
      ) : (
        <button className="primary" disabled={!valid} onClick={() => setConfirm(true)} data-testid="transfer-send">Send</button>
      )}
      <p className="muted small">Up to {naira(TRANSFER_LIMITS.max)} per transfer. Transfers are instant and can't be reversed, so check the name.</p>
    </section>
  );
}

function TradeSheet({ quote, holding, onDone, onToast, onRefresh }: Omit<MoneyProps, "economy"> & { quote: MarketQuote; holding: MarketStatus["holdings"][number] | undefined; onDone: () => void }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState(quote.kind === "crypto" ? 100_000 : 50_000);
  const [busy, setBusy] = useState(false);
  const run = async (value: number | "all") => {
    setBusy(true);
    try {
      const result = await api.trade(quote.id, side, value);
      onToast({ tone: "success", text: side === "buy" ? `Bought ${units(result.units)} ${quote.symbol} at ${naira(result.price)}.` : `Sold ${units(result.units)} ${quote.symbol} for ${naira(result.naira)}.` });
      await onRefresh();
      onDone();
    } catch (error) {
      onToast({ tone: "error", text: message(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="trade-sheet" data-testid="trade-sheet">
      <header className="row">
        <strong>{quote.name}</strong>
        <span className="muted">{naira(quote.price)}</span>
      </header>
      <div className="category-chips">
        <button className={`chip${side === "buy" ? " selected" : ""}`} onClick={() => setSide("buy")}>Buy</button>
        <button className={`chip${side === "sell" ? " selected" : ""}`} onClick={() => setSide("sell")} disabled={!holding}>Sell</button>
      </div>
      {holding && <p className="small">You hold {units(holding.units)} {quote.symbol} · worth {naira(holding.value)} · cost {naira(holding.invested)}</p>}
      <label className="field"><span>{side === "buy" ? "Naira to invest" : "Naira worth to sell"}</span><input type="number" inputMode="numeric" min={TRADE_LIMITS.min} max={TRADE_LIMITS.max} value={amount} onChange={(event) => setAmount(Math.floor(Number(event.target.value)))} /></label>
      <Chips values={[10_000, 50_000, 250_000, 1_000_000]} onPick={setAmount} />
      {side === "buy" && amount > 0 && <p className="muted small">≈ {units((amount * 0.995) / quote.price)} {quote.symbol} after the 0.5% fee.</p>}
      <div className="row">
        <button onClick={onDone}>Close</button>
        <button className="primary" disabled={busy || amount < TRADE_LIMITS.min} onClick={() => void run(amount)} data-testid="trade-go">{busy ? "…" : side === "buy" ? `Buy ${naira(amount)}` : `Sell ${naira(amount)}`}</button>
        {side === "sell" && <button disabled={busy} onClick={() => void run("all")}>Sell all</button>}
      </div>
    </section>
  );
}

function InvestTab({ onRefresh, onToast }: Omit<MoneyProps, "economy">) {
  const [market, setMarket] = useState<MarketStatus | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => api.market().then(setMarket).catch(() => undefined), []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [load]);
  if (!market) return <p className="muted">Loading market…</p>;
  const worth = market.holdings.reduce((sum, holding) => sum + holding.value, 0);
  const cost = market.holdings.reduce((sum, holding) => sum + holding.invested, 0);
  const chosen = market.quotes.find((quote) => quote.id === open);
  return (
    <div>
      <div className="balance-card portfolio">
        <span>Portfolio value</span>
        <strong>{naira(worth)}</strong>
        {cost > 0 && <small className={worth >= cost ? "credit" : "debit"}>{worth >= cost ? "▲" : "▼"} {naira(Math.abs(worth - cost))} ({percent((worth - cost) / cost)}) since you bought</small>}
      </div>
      {chosen && <TradeSheet quote={chosen} holding={market.holdings.find((holding) => holding.assetId === chosen.id)} onDone={() => { setOpen(null); void load(); }} onToast={onToast} onRefresh={onRefresh} />}
      <ul className="market-list">
        {market.quotes.map((quote) => {
          const holding = market.holdings.find((entry) => entry.assetId === quote.id);
          return (
            <li key={quote.id}>
              <button onClick={() => setOpen(quote.id)} data-testid={`asset-${quote.id}`}>
                <span className="ticker">{quote.kind === "crypto" ? "₿" : quote.symbol}</span>
                <span className="asset-name"><strong>{quote.name}</strong><small>{holding ? `You hold ${units(holding.units)}` : quote.blurb}</small></span>
                <Spark values={quote.history} up={quote.change24h >= 0} />
                <span className="asset-price"><strong>{naira(quote.price)}</strong><small className={quote.change24h >= 0 ? "credit" : "debit"}>{percent(quote.change24h)}</small></span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted small">Simulated prices in game naira, the same for every resident. These are not real companies or the real bitcoin price, and nothing can be cashed out.</p>
    </div>
  );
}

export function BankApp(props: MoneyProps) {
  const [tab, setTab] = useState<"account" | "invest">("account");
  const { economy } = props;
  return (
    <div className="app-section bank">
      <div className="category-chips">
        <button className={`chip${tab === "account" ? " selected" : ""}`} onClick={() => setTab("account")}>Account</button>
        <button className={`chip${tab === "invest" ? " selected" : ""}`} onClick={() => setTab("invest")} data-testid="bank-invest">Shares & bitcoin</button>
      </div>
      {tab === "account" ? (
        <>
          <div className="balance-card">
            <span>Lagos Living Bank · game naira</span>
            <strong>{economy ? naira(economy.balance) : "…"}</strong>
          </div>
          <DailyBonusCard onRefresh={props.onRefresh} onToast={props.onToast} />
          <TransferForm onRefresh={props.onRefresh} onToast={props.onToast} />
          <h3>Recent activity</h3>
          <ul className="transactions">
            {economy?.transactions.slice(0, 10).map((tx) => (
              <li key={tx.id}>
                <span>{tx.reference}</span>
                <strong className={tx.amount >= 0 ? "credit" : "debit"}>{tx.amount >= 0 ? "+" : ""}{naira(tx.amount)}</strong>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <InvestTab onRefresh={props.onRefresh} onToast={props.onToast} />
      )}
    </div>
  );
}

/* ---------- Betting ---------- */

const SLICE = 360 / SPIN_WHEEL.length;
const segmentColour = (multiplier: number) => SPIN_SEGMENTS.find((segment) => segment.multiplier === multiplier)?.colour ?? "#333";

function Wheel({ rotation, spinning }: { rotation: number; spinning: boolean }) {
  const r = 100;
  const slices = SPIN_WHEEL.map((multiplier, index) => {
    const a0 = ((index * SLICE - 90 - SLICE / 2) * Math.PI) / 180;
    const a1 = (((index + 1) * SLICE - 90 - SLICE / 2) * Math.PI) / 180;
    const mid = (a0 + a1) / 2;
    return (
      <g key={index}>
        <path d={`M0 0 L${r * Math.cos(a0)} ${r * Math.sin(a0)} A${r} ${r} 0 0 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)} Z`} fill={segmentColour(multiplier)} stroke="#111" strokeWidth="0.8" />
        <text x={74 * Math.cos(mid)} y={74 * Math.sin(mid)} fill="#fff" fontSize="10" fontWeight="700" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${(mid * 180) / Math.PI + 90} ${74 * Math.cos(mid)} ${74 * Math.sin(mid)})`}>
          {multiplier}×
        </text>
      </g>
    );
  });
  return (
    <div className="wheel-wrap">
      <span className="wheel-pointer" aria-hidden="true">▼</span>
      <div className={spinning ? "wheel-spin spinning" : "wheel-spin"}>
      <svg viewBox="-104 -104 208 208" width="220" height="220" className="wheel" style={{ transform: `rotate(${rotation}deg)` }}>
        <circle r="103" fill="#e6bd62" />
        {slices}
        <circle r="16" fill="#111" stroke="#e6bd62" strokeWidth="3" />
      </svg>
      </div>
    </div>
  );
}

type TabProps = { status: BettingStatus; offset: number; reload: () => Promise<void> } & Omit<MoneyProps, "economy">;

function SpinTab({ status, reload, onToast, onRefresh }: TabProps) {
  const [stake, setStake] = useState(1_000);
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<{ multiplier: number; payout: number } | null>(null);
  const place = async () => {
    setBusy(true);
    setResult(null);
    try {
      const spin = await api.betSpin(stake);
      const target = -spin.slice * SLICE;
      setSpinning(true);
      setRotation((current) => current - ((((current - target) % 360) + 360) % 360) - 360 * 5);
      await new Promise((resolve) => window.setTimeout(resolve, 3_200));
      setSpinning(false);
      setResult({ multiplier: spin.multiplier, payout: spin.payout });
      onToast(spin.payout > 0 ? { tone: "success", text: `${spin.multiplier}×! You won ${naira(spin.payout)}.` } : { tone: "info", text: `0× — the wheel kept ${naira(stake)}.` });
      await reload();
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: message(error) });
    } finally {
      setBusy(false);
      setSpinning(false);
    }
  };
  return (
    <div className="spin-tab">
      <Wheel rotation={rotation} spinning={false} />
      <p className="spin-timer" data-testid="spin-timer">
        {spinning ? "Spinning…" : result ? (result.payout > 0 ? `${result.multiplier}× · you won ${naira(result.payout)}` : "0× · try again") : "Your own wheel: tap spin and see the result straight away."}
      </p>
      {status.spin.last.length > 0 && (
        <div className="spin-history">
          {status.spin.last.map((entry) => <span key={entry.round} style={{ background: segmentColour(entry.multiplier) }}>{entry.multiplier}×</span>)}
        </div>
      )}
      <label className="field"><span>Stake (₦)</span><input type="number" inputMode="numeric" min={BET_LIMITS.min} max={BET_LIMITS.max} value={stake} onChange={(event) => setStake(Math.floor(Number(event.target.value)))} /></label>
      <div className="category-chips">
        {[500, 1_000, 5_000, 20_000, 100_000].map((value) => <button key={value} className="chip" onClick={() => setStake(value)}>₦{value / 1000}k</button>)}
        <button className="chip" onClick={() => setStake((value) => Math.min(BET_LIMITS.max, value * 2))}>2×</button>
        <button className="chip" onClick={() => setStake((value) => Math.max(BET_LIMITS.min, Math.floor(value / 2)))}>½</button>
      </div>
      <button className="primary" disabled={busy || stake < BET_LIMITS.min || stake > BET_LIMITS.max} onClick={() => void place()} data-testid="spin-bet">
        {busy ? "Spinning…" : `Spin for ${naira(stake)}`}
      </button>
      <p className="muted small">Land on 2× and your stake doubles; 0× loses it. On average the wheel pays back about {Math.round(status.returnToPlayer * 100)}% of stakes. Game naira only.</p>
    </div>
  );
}

function FixtureRow({ fixture, children }: { fixture: Fixture; children: React.ReactNode }) {
  const home = footballClub(fixture.home)!;
  const away = footballClub(fixture.away)!;
  return (
    <li className="fixture">
      <div className="teams"><span>{home.name}</span><small>{home.league}</small><span>{away.name}</span></div>
      {children}
    </li>
  );
}

function FootballTab({ status, offset, reload, onToast, onRefresh }: TabProps) {
  const now = useNow(1000);
  const [slip, setSlip] = useState<{ fixture: Fixture; pick: Pick } | null>(null);
  const [stake, setStake] = useState(2_000);
  const [busy, setBusy] = useState(false);
  const kickoff = Math.max(0, Math.ceil((status.football.kickoffAt - (now - offset)) / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => void reload(), 15_000);
    return () => window.clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    if (kickoff === 0) void reload().then(onRefresh);
  }, [kickoff, reload, onRefresh]);
  const place = async () => {
    if (!slip) return;
    setBusy(true);
    try {
      const result = await api.betFootball(slip.fixture.id, slip.pick, stake);
      onToast({ tone: "success", text: `Bet placed at ${result.odds}. Potential return ${naira(Math.floor(stake * result.odds))}.` });
      setSlip(null);
      await reload();
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: message(error) });
    } finally {
      setBusy(false);
    }
  };
  const label = (fixture: Fixture, pick: Pick) => (pick === "draw" ? "Draw" : footballClub(pick === "home" ? fixture.home : fixture.away)!.short);
  return (
    <div className="football-tab">
      <h3>Next round · kicks off in {Math.floor(kickoff / 60)}:{String(kickoff % 60).padStart(2, "0")}</h3>
      <ul className="fixtures">
        {status.football.upcoming.map((fixture) => (
          <FixtureRow key={fixture.id} fixture={fixture}>
            <div className="odds">
              {(["home", "draw", "away"] as const).map((pick) => (
                <button key={pick} className={slip?.fixture.id === fixture.id && slip.pick === pick ? "selected" : ""} onClick={() => setSlip({ fixture, pick })}>
                  <small>{label(fixture, pick)}</small>
                  <b>{fixture.odds[pick].toFixed(2)}</b>
                </button>
              ))}
            </div>
          </FixtureRow>
        ))}
      </ul>
      {slip && (
        <section className="bet-slip" data-testid="bet-slip">
          <strong>{label(slip.fixture, slip.pick) === "Draw" ? "Draw" : `${footballClub(slip.pick === "home" ? slip.fixture.home : slip.fixture.away)!.name} to win`} @ {slip.fixture.odds[slip.pick].toFixed(2)}</strong>
          <label className="field"><span>Stake (₦)</span><input type="number" inputMode="numeric" value={stake} onChange={(event) => setStake(Math.floor(Number(event.target.value)))} /></label>
          <Chips values={[1_000, 5_000, 20_000, 100_000]} onPick={setStake} />
          <p className="small">Returns {naira(Math.floor(stake * slip.fixture.odds[slip.pick]))} if it comes in.</p>
          <div className="row">
            <button onClick={() => setSlip(null)}>Cancel</button>
            <button className="primary" disabled={busy || stake < BET_LIMITS.min || stake > BET_LIMITS.max} onClick={() => void place()} data-testid="football-bet">{busy ? "Placing…" : "Place bet"}</button>
          </div>
        </section>
      )}
      <h3>Live now</h3>
      <ul className="fixtures">
        {status.football.live.map((fixture) => (
          <FixtureRow key={fixture.id} fixture={fixture}>
            <div className="score"><b>{fixture.score ? `${fixture.score.home} – ${fixture.score.away}` : "–"}</b><small>{fixture.final ? "FT" : `${fixture.minute}'`}</small></div>
          </FixtureRow>
        ))}
      </ul>
      <h3>Last round</h3>
      <ul className="fixtures">
        {status.football.results.map((fixture) => (
          <FixtureRow key={fixture.id} fixture={fixture}>
            <div className="score"><b>{fixture.score ? `${fixture.score.home} – ${fixture.score.away}` : "–"}</b><small>FT</small></div>
          </FixtureRow>
        ))}
      </ul>
      <p className="muted small">Real club names, simulated matches: scores are random (stronger teams score more often), the same for every resident, and are not real results. A new round kicks off every 10 minutes.</p>
    </div>
  );
}

export function BetApp({ onRefresh, onToast }: Omit<MoneyProps, "economy">) {
  const [tab, setTab] = useState<"spin" | "football" | "mine">("spin");
  const [status, setStatus] = useState<BettingStatus | null>(null);
  const [offset, setOffset] = useState(0);
  const reload = useCallback(
    () =>
      api.betting().then((next) => {
        setOffset(Date.now() - next.now);
        setStatus(next);
      }).catch(() => undefined),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  if (!status) return <p className="muted">Loading…</p>;
  return (
    <div className="app-section bet-app">
      <div className="category-chips">
        <button className={`chip${tab === "spin" ? " selected" : ""}`} onClick={() => setTab("spin")}>🎡 Spin</button>
        <button className={`chip${tab === "football" ? " selected" : ""}`} onClick={() => setTab("football")} data-testid="bet-football">⚽ Football</button>
        <button className={`chip${tab === "mine" ? " selected" : ""}`} onClick={() => { setTab("mine"); void reload(); }}>My bets</button>
      </div>
      {tab === "spin" && <SpinTab status={status} offset={offset} reload={reload} onToast={onToast} onRefresh={onRefresh} />}
      {tab === "football" && <FootballTab status={status} offset={offset} reload={reload} onToast={onToast} onRefresh={onRefresh} />}
      {tab === "mine" && (
        <ul className="transactions">
          {status.bets.length === 0 && <li className="muted">No bets yet.</li>}
          {status.bets.map((bet) => (
            <li key={bet.id}>
              <span>{bet.detail}<br /><small className="muted">Stake {naira(bet.stake)}{bet.odds ? ` @ ${bet.odds.toFixed(2)}` : ""}</small></span>
              <strong className={bet.status === "won" ? "credit" : bet.status === "lost" ? "debit" : ""}>{bet.status === "pending" ? "Open" : bet.status === "won" ? `+${naira(bet.payout)}` : "Lost"}</strong>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Game naira only. No real money, deposits or cash-out.</p>
    </div>
  );
}

/* ---------- Documents ---------- */

function digits(seed: string, count: number) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  let out = "";
  for (let index = 0; index < count; index += 1) {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507) >>> 0;
    out += String(hash % 10);
  }
  return out;
}

export function DocumentsApp({ playerName, vehicles }: { playerName: string; vehicles: number }) {
  const name = playerName.toUpperCase();
  const initials = playerName.slice(0, 2).toUpperCase();
  const passportNo = `A${digits(`passport:${playerName}`, 8)}`;
  const licenceNo = `LAG-${digits(`licence:${playerName}`, 3)}-${digits(`licence2:${playerName}`, 5)}`;
  return (
    <div className="app-section documents">
      <article className="id-card passport" data-testid="passport">
        <i className="watermark">GAME ID · NOT A REAL DOCUMENT</i>
        <header><span>🦅</span><div><strong>LAGOS LIVING</strong><small>Passport · in-game</small></div></header>
        <div className="id-body">
          <div className="photo">{initials}</div>
          <dl>
            <div><dt>Name</dt><dd>{name}</dd></div>
            <div><dt>Nationality</dt><dd>Nigerian (game)</dd></div>
            <div><dt>Passport no.</dt><dd>{passportNo}</dd></div>
            <div><dt>Valid for</dt><dd>Lagos ⇄ Dubai flights</dd></div>
          </dl>
        </div>
        <footer>P&lt;NGA{name.replace(/[^A-Z]/g, "")}&lt;&lt;{passportNo}&lt;&lt;&lt;</footer>
      </article>
      <article className="id-card licence" data-testid="licence">
        <i className="watermark">GAME ID · NOT A REAL DOCUMENT</i>
        <header><span>🚗</span><div><strong>LAGOS LIVING</strong><small>Driving licence · in-game</small></div></header>
        <div className="id-body">
          <div className="photo">{initials}</div>
          <dl>
            <div><dt>Name</dt><dd>{name}</dd></div>
            <div><dt>Licence no.</dt><dd>{licenceNo}</dd></div>
            <div><dt>Class</dt><dd>B · cars and SUVs</dd></div>
            <div><dt>Vehicles</dt><dd>{vehicles} registered</dd></div>
          </dl>
        </div>
      </article>
      <p className="muted small">Fictional in-game documents. The airport checks your game passport; it is not a real Nigerian passport or licence and can't be used outside the game.</p>
    </div>
  );
}
