import { AccountSection } from "./AccountSection";
import { BIKE_RENTAL, HOUSE_DESIGNS, DELIVERY_FEE, DELIVERY_MENU, DELIVERY_SECONDS, HOME_DELIVERY_SECONDS, SEATED_MEAL_ENERGY, type FoodParcel, HOME_STAFF, HOME_STAFF_ROLES, getPlace, type DeliveryItem, type GigStatus, nearestStop, plotById, readyBuiltPrice, ROUTES, type RideState, type TowState, type Notice, type PlayerSettings, type Vec2 } from "@lagos-living/shared";
import { useEffect, useState } from "react";
import { api, naira, type EconomyState, type InteriorState, type MyVehicle, type PlotState, type PropertyListing } from "../api";
import { actionLabels, keyLabel, type Action, type Bindings } from "../game/controller";
import type { GameEngine, HudState } from "../game/engine";
import { RideApp } from "./RideApp";
import { CommunityApp } from "./CommunitySheets";
import { TravelApp } from "./TravelApp";
import { VehiclesApp } from "./VehicleSheets";
import { JusticeApp, SafetyApp, type ReportTarget } from "./SafetyUI";
import { NeighboursApp } from "./NeighboursApp";
import { GoApp } from "./GoApp";
import { FriendsApp } from "./FriendsApp";
import { InviteApp } from "./InviteApp";
import { RankingsApp } from "./RankingsApp";
import { PlacesApp, type CabDestination } from "./PlacesApp";
import { GamesApp } from "./games/GamesApp";
import { BusinessApp } from "./BusinessApp";
import { StoryApp } from "./StoryApp";
import { EstateApp } from "./EstateApp";
import { BoutiqueApp } from "./BoutiqueApp";
import { BankApp, BetApp, DocumentsApp } from "./FinanceApps";
import { HangarApp } from "./HangarApp";

export type PhoneApp = "home" | "story" | "games" | "business" | "estate" | "places" | "boutique" | "go" | "map" | "ride" | "travel" | "hangar" | "transport" | "jobs" | "wallet" | "order" | "bank" | "bet" | "documents" | "property" | "vehicles" | "community" | "justice" | "safety" | "friends" | "neighbours" | "invite" | "rankings" | "notifications" | "settings" | "help";

const APPS: Array<{ id: PhoneApp; label: string; icon: string; tint: string }> = [
  { id: "story", label: "My Story", icon: "📖", tint: "#e7bd62, #ff9f0a" },
  { id: "places", label: "Places", icon: "📍", tint: "#ff3b30, #ff6b5e" },
  { id: "go", label: "Go", icon: "⚡", tint: "#ffcc00, #ff9500" },
  { id: "estate", label: "Estate", icon: "🏢", tint: "#5856d6, #7d7aff" },
  { id: "boutique", label: "Boutique", icon: "👔", tint: "#ff2d55, #ff6482" },
  { id: "map", label: "Map", icon: "🗺", tint: "#34c759, #30b0c7" },
  { id: "ride", label: "Ride", icon: "🚕", tint: "#1c1c1e, #3a3a3c" },
  { id: "travel", label: "Travel", icon: "✈", tint: "#0a84ff, #64d2ff" },
  { id: "hangar", label: "Hangar", icon: "🚁", tint: "#1c1c1e, #c8a24a" },
  { id: "transport", label: "Transport", icon: "🚌", tint: "#ff9f0a, #ffd60a" },
  { id: "jobs", label: "Jobs", icon: "📦", tint: "#a2845e, #c9a477" },
  { id: "bank", label: "Bank", icon: "🏦", tint: "#0b6e4f, #2fbf71" },
  { id: "business", label: "Business", icon: "💼", tint: "#48484a, #8e8e93" },
  { id: "order", label: "Order", icon: "🛵", tint: "#ff6b00, #ff9f45" },
  { id: "bet", label: "Bet", icon: "🎰", tint: "#bf5af2, #da8fff" },
  { id: "games", label: "Games", icon: "🎮", tint: "#5e5ce6, #bf5af2" },
  { id: "wallet", label: "Wallet", icon: "₦", tint: "#111111, #2c2c2e" },
  { id: "documents", label: "My ID", icon: "🪪", tint: "#64d2ff, #0a84ff" },
  { id: "property", label: "My Home", icon: "🏠", tint: "#ff9500, #ffb340" },
  { id: "vehicles", label: "Vehicles", icon: "🚗", tint: "#0a84ff, #5e5ce6" },
  { id: "community", label: "Community", icon: "🤝", tint: "#30d158, #66d4cf" },
  { id: "justice", label: "Justice", icon: "⚖", tint: "#8e6c3a, #b08d57" },
  { id: "safety", label: "Safety", icon: "🛡", tint: "#ff453a, #ff9f0a" },
  { id: "rankings", label: "Rankings", icon: "🏆", tint: "#ffd60a, #ff9f0a" },
  { id: "neighbours", label: "Neighbours", icon: "🏘", tint: "#30d158, #34c759" },
  { id: "friends", label: "Friends", icon: "👥", tint: "#32ade6, #5ac8fa" },
  { id: "invite", label: "Invite", icon: "🎁", tint: "#ff2d55, #ffcc00" },
  { id: "notifications", label: "Alerts", icon: "🔔", tint: "#ff3b30, #ff9500" },
  { id: "settings", label: "Settings", icon: "⚙", tint: "#8e8e93, #aeaeb2" },
  { id: "help", label: "Help", icon: "?", tint: "#007aff, #5ac8fa" },
];

const DOCK = new Set<PhoneApp>(["go", "ride", "bank", "settings"]);

/** Apps about life in Lagos, hidden from the home screen while the player is in Dubai. */
const LAGOS_ONLY = new Set<PhoneApp>(["transport", "jobs", "order", "property", "community", "justice", "estate"]);

type Props = {
  app: PhoneApp;
  setApp: (app: PhoneApp) => void;
  onClose: () => void;
  economy: EconomyState | null;
  properties: PropertyListing[];
  vehicles: MyVehicle[];
  hud: HudState | null;
  notices: Array<Notice & { at: number }>;
  settings: PlayerSettings;
  bindings: Bindings;
  quality: string;
  onSettings: (settings: PlayerSettings) => void;
  onBindings: (bindings: Bindings) => void;
  onQuality: (quality: string) => void;
  onNavigate: (target: { point: Vec2; label: string } | null) => void;
  onOpenMap: () => void;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
  onUnstuck: () => void;
  onReset: () => Promise<void>;
  onEat: (itemId: string) => Promise<void>;
  onInteriorChanged: () => void;
  /** Opens the top-down home designer for a home the player owns or rents. */
  onDesign: (propertyId: string) => void;
  /** Fly the camera drone over a home you own or rent. */
  onDrone: (propertyId: string, name: string) => void;
  plots: PlotState[];
  onReport: (target: ReportTarget) => void;
  onCustomise: () => void;
  onSignOut: () => void;
  playerName: string;
  engine: GameEngine | null;
  ride: RideState | null;
  tows: TowState[];
  onParcel: (parcel: FoodParcel) => void;
};

function days(iso: string | null) {
  if (!iso) return null;
  return (new Date(iso).getTime() - Date.now()) / 86_400_000;
}

function dueText(iso: string | null) {
  const remaining = days(iso);
  if (remaining === null) return "—";
  const date = new Date(iso!).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" });
  if (remaining < 0) return `Overdue since ${date}`;
  if (remaining < 1) return `Due today (${date})`;
  return `${date} · in ${Math.ceil(remaining)} day${Math.ceil(remaining) === 1 ? "" : "s"}`;
}

export function Phone(props: Props) {
  const { app, setApp, onClose } = props;
  const [cabTo, setCabTo] = useState<CabDestination | null>(null);
  const title = APPS.find((entry) => entry.id === app)?.label ?? "Phone";
  const inDubai = props.engine?.playerRegion() === "dubai";
  const home = app === "home";
  const visible = APPS.filter((entry) => !inDubai || !LAGOS_ONLY.has(entry.id));
  const icon = (entry: (typeof APPS)[number]) => (
    <button key={entry.id} className="app-icon" onClick={() => (entry.id === "map" ? props.onOpenMap() : setApp(entry.id))}>
      <span style={{ background: `linear-gradient(160deg, ${entry.tint})` }}>{entry.icon}</span>
      {entry.label}
      {entry.id === "property" && props.properties.some((listing) => listing.isMine && (days(listing.nextPaymentAt) ?? 9) < 2) && <i className="badge" />}
    </button>
  );
  return (
    <aside className={`phone${home ? " on-home" : ""}`} role="dialog" aria-label="Phone">
      <div className="phone-status">
        <span className="phone-time">{new Date().toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", hour12: false })}</span>
        <span className="phone-island" aria-hidden="true" />
        <span className="phone-indicators" aria-hidden="true">
          <i className="signal"><b /><b /><b /><b /></i>
          <i className="wifi" />
          <i className="battery"><b /></i>
        </span>
      </div>
      <header className="phone-header">
        {!home ? <button className="phone-back" onClick={() => setApp("home")} aria-label="Back">‹ Home</button> : <span />}
        <h2>{home ? "" : title}</h2>
        <button
          className="icon-button"
          onClick={() => props.onSettings({ ...props.settings, muted: !props.settings.muted })}
          aria-label={props.settings.muted ? "Unmute game sounds" : "Mute game sounds"}
          title={props.settings.muted ? "Sound off — tap to unmute" : "Tap to mute all game sounds"}
        >
          {props.settings.muted ? "🔇" : "🔊"}
        </button>
        <button className="icon-button" onClick={onClose} aria-label="Close phone">✕</button>
      </header>
      <div className="phone-body">
        {home && (
          <>
            <button className="phone-widget" onClick={() => setApp("wallet")}>
              <small>Wallet · game naira</small>
              <strong>{props.economy ? naira(props.economy.balance) : "…"}</strong>
              {props.economy && <span>Hunger {Math.round(props.economy.needs.hunger)} · Energy {Math.round(props.economy.needs.energy)}</span>}
            </button>
            <div className="app-grid">
              {inDubai && <p className="phone-region-note" data-testid="dubai-phone-note">🇦🇪 You're in Dubai. Lagos apps (Jobs, Danfo, Order, My Home…) come back when you fly home from Dubai International.</p>}
              {visible.filter((entry) => !DOCK.has(entry.id)).map(icon)}
            </div>
          </>
        )}
        {app === "places" && (
          <PlacesApp engine={props.engine} hud={props.hud} onNavigate={props.onNavigate} onCab={(destination) => { setCabTo(destination); setApp("ride"); }} onClose={onClose} />
        )}
        {app === "games" && <GamesApp />}
        {app === "estate" && <EstateApp properties={props.properties} plots={props.plots} here={props.hud ? [props.hud.x, props.hud.z] : null} onRefresh={props.onRefresh} onToast={props.onToast} onNavigate={props.onNavigate} onView={props.engine ? (id, label) => props.engine!.estateViewing(id, label) : undefined} onClose={onClose} />}
        {app === "story" && <StoryApp onRefresh={props.onRefresh} onToast={props.onToast} onBusiness={() => setApp("business")} />}
        {app === "business" && <BusinessApp onRefresh={props.onRefresh} onToast={props.onToast} />}
        {app === "go" && <GoApp engine={props.engine} onNavigate={props.onNavigate} onClose={onClose} />}
        {app === "boutique" && <BoutiqueApp engine={props.engine} economy={props.economy} onRefresh={props.onRefresh} onToast={props.onToast} />}
        {app === "ride" && <RideApp key={cabTo?.key ?? "ride"} engine={props.engine} ride={props.ride} properties={props.properties} initial={cabTo} onNavigate={props.onNavigate} onClose={onClose} />}
        {app === "travel" && <TravelApp engine={props.engine} economy={props.economy} onNavigate={props.onNavigate} onRefresh={props.onRefresh} onToast={props.onToast} onClose={onClose} />}
        {app === "hangar" && <HangarApp engine={props.engine} economy={props.economy} onRefresh={props.onRefresh} onToast={props.onToast} onClose={onClose} />}
        {app === "transport" && <TransportApp {...props} />}
        {app === "jobs" && <JobsApp {...props} />}
        {app === "wallet" && <WalletApp {...props} />}
        {app === "order" && <OrderApp {...props} />}
        {app === "bank" && <BankApp economy={props.economy} onRefresh={props.onRefresh} onToast={props.onToast} />}
        {app === "bet" && <BetApp onRefresh={props.onRefresh} onToast={props.onToast} />}
        {app === "documents" && <DocumentsApp playerName={props.playerName} vehicles={props.vehicles.length} />}
        {app === "property" && <PropertyApp {...props} />}
        {app === "vehicles" && (
          <VehiclesApp
            engine={props.engine}
            tows={props.tows}
            vehicles={props.vehicles}
            properties={props.properties}
            position={props.hud ? [props.hud.x, props.hud.z] : null}
            drivingId={props.hud?.vehicle?.id ?? null}
            onNavigate={props.onNavigate}
            onRefresh={props.onRefresh}
            onToast={props.onToast}
            onClose={onClose}
          />
        )}
        {app === "community" && <CommunityApp onNavigate={props.onNavigate} onClose={onClose} />}
        {app === "justice" && <JusticeApp onToast={props.onToast} onRefresh={props.onRefresh} />}
        {app === "safety" && <SafetyApp onToast={props.onToast} onReport={props.onReport} />}
        {app === "neighbours" && <NeighboursApp engine={props.engine} onToast={(text) => props.onToast({ tone: "info", text })} onOpen={setApp} />}
        {app === "friends" && <FriendsApp online={props.hud?.online ?? 1} onToast={props.onToast} />}
        {app === "rankings" && <RankingsApp onToast={props.onToast} />}
        {app === "invite" && <InviteApp onToast={props.onToast} onRefresh={props.onRefresh} />}
        {app === "notifications" && (
          <ul className="notice-log">
            {props.notices.length === 0 && <li className="muted">No notifications yet.</li>}
            {[...props.notices].reverse().map((notice) => (
              <li key={notice.at + notice.text} className={notice.tone}>
                <time>{new Date(notice.at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</time>
                {notice.text}
              </li>
            ))}
          </ul>
        )}
        {app === "settings" && <SettingsApp {...props} />}
        {app === "help" && <HelpApp {...props} />}
      </div>
      {home && <nav className="phone-dock">{visible.filter((entry) => DOCK.has(entry.id)).map(icon)}</nav>}
      <button className="phone-home-bar" onClick={() => (home ? onClose() : setApp("home"))} aria-label={home ? "Put the phone away" : "Home screen"} />
    </aside>
  );
}

function BikesSection({ engine, onNavigate, onClose }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!engine) return null;
  const { stations, hire } = engine.bikeStatus();
  const sorted = [...stations].sort((a, b) => a.distance - b.distance);
  const go = (point: Vec2, label: string) => {
    onNavigate({ point, label });
    onClose();
  };
  return (
    <section className="route bikes" data-testid="bikes">
      <div className="route-card">
        <span className="route-number">🚲</span>
        <div>
          <strong>Lagos Bike Hire</strong>
          <p className="muted">{naira(BIKE_RENTAL.unlockFee)} unlock + {naira(BIKE_RENTAL.perMinute)}/min · {naira(BIKE_RENTAL.deposit)} deposit, refunded minus the ride when you dock at any station</p>
        </div>
      </div>
      {hire && (
        <div className="callout" data-testid="bike-hire">
          {hire.riding ? "Riding your hired bike" : "Your hired bike is locked on the street"} · {hire.minutes} min · {naira(hire.usage)} so far
          <div className="row">
            {!hire.riding && <button onClick={() => go(hire.point, "Your hired bike")}>Find my bike</button>}
            <button onClick={() => go(sorted.find((station) => station.stock < BIKE_RENTAL.docks)?.point ?? sorted[0]!.point, "Nearest dock with space")}>Nearest dock with space</button>
          </div>
        </div>
      )}
      <ol className="stop-list">
        {sorted.map((station) => (
          <li key={station.id} data-testid={`bike-station-${station.id}`}>
            <span>
              {station.name}
              <small className="muted"> · {station.stock} bike{station.stock === 1 ? "" : "s"} · {BIKE_RENTAL.docks - station.stock} free dock{BIKE_RENTAL.docks - station.stock === 1 ? "" : "s"} · {station.distance >= 1000 ? `${(station.distance / 1000).toFixed(1)} km` : `${Math.round(station.distance)} m`}</small>
            </span>
            <button className="link" onClick={() => go(station.point, `${station.name} bikes`)}>Navigate</button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TransportApp(props: Props) {
  const { hud, onNavigate, onClose } = props;
  const nearest = hud ? nearestStop(hud.x, hud.z) : null;
  const routes = nearest ? [nearest.route, ...ROUTES.filter((route) => route !== nearest.route)] : ROUTES;
  return (
    <div className="app-section">
      <BikesSection {...props} />
      {hud?.bus && (
        <p className="callout">Aboard {hud.bus.routeNumber} · seat {hud.bus.seat !== null ? hud.bus.seat + 1 : "—"} · next stop {hud.bus.nextStop}{hud.bus.stopRequested ? " · stop requested" : ""}</p>
      )}
      {nearest && (
        <button className="primary" onClick={() => { onNavigate({ point: nearest.alight, label: nearest.name }); onClose(); }}>
          Guide me to the nearest stop ({nearest.route.routeNumber})
        </button>
      )}
      {routes.map((route) => (
        <section key={route.routeId} className="route" data-testid={`route-${route.routeNumber}`}>
          <div className="route-card">
            <span className="route-number">{route.routeNumber}</span>
            <div>
              <strong>{route.routeName}</strong>
              <p className="muted">Flat fare {naira(route.fare)} · pay once when you board · {Math.round(route.length)} m loop</p>
            </div>
          </div>
          <ol className="stop-list">
            {route.stops.map((stop) => (
              <li key={stop.id}>
                <span>{stop.name}</span>
                <button className="link" onClick={() => { onNavigate({ point: stop.alight, label: stop.name }); onClose(); }}>Navigate</button>
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className="muted small">How to ride: wait at the yellow stop sign. When the danfo stops and the door opens, press E to board. Press Q to request your stop, then E to step off once it halts. Each loop stays in its district; cross between districts on foot or by car.</p>
      <p className="muted small">Gameplay simplification: OpenStreetMap has no bus stops mapped on these roads, so the stops and each loop's U-turns are game placements on real Admiralty Way, Bourdillon Road and Adeola Odeku Street geometry.</p>
    </div>
  );
}

function GigBoard({ onNavigate, onClose, onRefresh, onToast }: Props) {
  const [status, setStatus] = useState<GigStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.gigs().then(setStatus).catch(() => setStatus(null));
  }, []);
  if (!status) return <p className="muted">Loading gigs…</p>;
  const go = (placeId: string) => {
    const place = getPlace(placeId);
    onNavigate({ point: place.door, label: place.name });
    onClose();
  };
  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await work();
      setStatus(await api.gigs());
      await onRefresh();
      after?.();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const active = status.active;
  const minutes = Math.max(1, Math.ceil((status.nextBoardAt - Date.now()) / 60_000));
  return (
    <section>
      <h3>Gig board · big-money jobs</h3>
      {active ? (
        <div className="job-card" data-testid="gig-active">
          <p>{active.emoji} <strong>{active.title}</strong> · {naira(active.reward)}</p>
          <p>{active.task} <strong>{getPlace(active.placeId).name}</strong>. {active.handsOn ? (active.status === "working" ? "The generator is beside the door. Find the fault, fix it and start it to get paid." : "Go there and tap “Start job” at the door, then find and fix the generator's fault.") : active.status === "working" ? "You're on the job — stay at the place until the timer ends." : `Go there and tap “Start job” at the door, then stay ${active.workSeconds} s.`}</p>
          <div className="row">
            <button className="primary" onClick={() => go(active.placeId)}>Directions</button>
            <button className="secondary" disabled={busy} onClick={() => void run(() => api.cancelGig(), () => onToast({ tone: "info", text: "Gig cancelled." }))}>Cancel gig</button>
          </div>
        </div>
      ) : (
        <ul className="gig-board">
          {status.board.map((gig) => (
            <li key={gig.id}>
              <span>{gig.emoji}</span>
              <div>
                <strong>{gig.title}</strong>
                <small>{gig.task} {getPlace(gig.placeId).name} · {gig.handsOn ? "hands-on: diagnose and fix" : `${gig.workSeconds} s on site`}</small>
                <b>{naira(gig.reward)}</b>
              </div>
              <button className="primary" disabled={busy} data-testid={`gig-take-${gig.typeId}`} onClick={() => void run(() => api.takeGig(gig.id), () => { onToast({ tone: "success", text: `Gig taken: ${gig.title}. Directions are on.` }); go(gig.placeId); })}>Take</button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">New gigs in {minutes} min. Every resident sees the same board. Completed: {status.completed} · earned {naira(status.earned)}.</p>
    </section>
  );
}

function JobsApp(props: Props) {
  const { economy, onNavigate, onClose, onRefresh, onToast } = props;
  const job = economy?.activeJob;
  return (
    <div className="app-section">
      <GigBoard {...props} />
      <h3>Swift Parcel Hub</h3>
      <p className="muted">Fictional courier service · Adebayo Doherty Road</p>
      {job ? (
        <div className="job-card">
          <p>Deliver a parcel to <strong>{job.destinationLabel}</strong></p>
          <p>Pays <strong>{naira(job.reward)}</strong> on delivery</p>
          <div className="row">
            <button className="primary" onClick={() => { onNavigate({ point: [job.destinationX, job.destinationZ], label: job.destinationLabel ?? "Delivery" }); onClose(); }}>Navigate</button>
            <button className="secondary" onClick={async () => {
              try {
                await api.cancelDelivery();
                onToast({ tone: "info", text: "Delivery cancelled. The parcel went back to the hub." });
                await onRefresh();
              } catch (error) {
                onToast({ tone: "error", text: (error as Error).message });
              }
            }}>Cancel job</button>
          </div>
        </div>
      ) : (
        <>
          <p>No active job. Visit the hub door to collect a parcel.</p>
          <button className="primary" onClick={() => { onNavigate({ point: [-524.96, 365.6], label: "Swift Parcel Hub" }); onClose(); }}>Navigate to the hub</button>
        </>
      )}
      <p className="muted small">Completed deliveries: {economy?.completedJobs ?? 0}</p>
    </div>
  );
}

function WalletApp({ economy, onEat }: Props) {
  if (!economy) return <p className="muted">Loading wallet…</p>;
  const food = economy.inventory.filter((item) => item.category === "food");
  return (
    <div className="app-section">
      <div className="balance-card">
        <span>Game naira (fictional)</span>
        <strong>{naira(economy.balance)}</strong>
      </div>
      <div className="needs">
        <label>Hunger <meter min={0} max={100} value={economy.needs.hunger} /></label>
        <label>Energy <meter min={0} max={100} value={economy.needs.energy} /></label>
      </div>
      <h3>Bag</h3>
      {economy.inventory.length === 0 && <p className="muted">Your bag is empty.</p>}
      <ul className="bag">
        {economy.inventory.map((item) => (
          <li key={item.itemId}>
            <span>{item.name} ×{item.quantity}</span>
            {food.includes(item) && <button className="link" onClick={() => void onEat(item.itemId)}>Eat</button>}
          </li>
        ))}
      </ul>
      <h3>Recent transactions</h3>
      <ul className="transactions">
        {economy.transactions.slice(0, 12).map((tx) => (
          <li key={tx.id}>
            <span>{tx.reference}</span>
            <strong className={tx.amount >= 0 ? "credit" : "debit"}>{tx.amount >= 0 ? "+" : ""}{naira(tx.amount)}</strong>
          </li>
        ))}
      </ul>
      <p className="muted small">Fictional currency for play only — no real money, crypto or cash-out.</p>
    </div>
  );
}

function HomeServices({ propertyId, inside, onRefresh, onToast }: { propertyId: string; inside: boolean; onRefresh: () => Promise<void>; onToast: (notice: Notice) => void }) {
  const [state, setState] = useState<InteriorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const load = () => api.interior(propertyId).then(setState).catch(() => setState(null));
  useEffect(() => {
    if (open || inside) void load();
  }, [propertyId, open, inside]);
  const run = async (text: string, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      onToast({ tone: "success", text });
      await load();
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  if (!open && !inside) return <button className="link" onClick={() => setOpen(true)}>Staff & party ›</button>;
  const party = state?.partyUntil && new Date(state.partyUntil).getTime() > Date.now();
  return (
    <div className="home-services">
      <h4>Household staff</h4>
      {HOME_STAFF_ROLES.map((role) => {
        const info = HOME_STAFF[role];
        const hired = state?.staff?.find((entry) => entry.role === role);
        return (
          <div key={role} className="staff-row">
            <span>{info.emoji}</span>
            <div><strong>{info.name}</strong><small>{hired ? `On duty until ${new Date(hired.paidUntil).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" })}` : info.blurb}</small></div>
            <button className={hired ? "secondary" : "primary"} disabled={busy || !state?.access.owner} data-testid={`hire-${role}`} onClick={() => void run(hired ? `${info.name} kept on for another week.` : `${info.name} hired for a week.`, () => api.hireStaff(propertyId, role))}>
              {hired ? `+1 week ${naira(info.weekly)}` : `Hire ${naira(info.weekly)}/wk`}
            </button>
          </div>
        );
      })}
      <p className="muted small">Gatemen and guards stand at built houses with gates; everyone can see them. Without a cleaner, use “Clean” at home yourself.</p>
      <h4>House party</h4>
      {inside ? (
        <button className={party ? "secondary wide" : "primary wide"} disabled={busy || !state?.access.owner} data-testid="party-toggle" onClick={() => void run(party ? "Party over. Lights back to normal." : "🎉 Party started! Your invited friends have been told.", () => api.party(propertyId, !party))}>
          {party ? "End the party" : "🎉 Start a party (music, lights, invite friends)"}
        </button>
      ) : (
        <p className="muted small">Go inside to start a party. Invite friends from the home designer first; they get told when it starts.</p>
      )}
    </div>
  );
}

function OrderApp({ properties, onRefresh, onToast, onClose, onParcel }: Props) {
  const [shop, setShop] = useState<"food" | "pharmacy">("food");
  const [busy, setBusy] = useState<string | null>(null);
  const home = properties.find((listing) => listing.isHome && (listing.isMine || listing.hasGuestAccess));
  const [destination, setDestination] = useState<"here" | "home">("here");
  const order = async (item: DeliveryItem) => {
    setBusy(item.id);
    try {
      const result = await api.orderDelivery(item.id, destination);
      const seconds = destination === "home" ? HOME_DELIVERY_SECONDS : DELIVERY_SECONDS;
      onToast({ tone: "info", text: destination === "home" ? `Order placed: ${item.name}. The rider will be at your front door in about ${seconds} s.` : `Order placed: ${item.name}. A rider is coming to where you are now (about ${seconds} s).` });
      onParcel(result.parcel);
      await onRefresh();
      onClose();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="app-section">
      <div className="category-chips">
        <button className={`chip${shop === "food" ? " selected" : ""}`} onClick={() => setShop("food")}>🍛 Food</button>
        <button className={`chip${shop === "pharmacy" ? " selected" : ""}`} onClick={() => setShop("pharmacy")} data-testid="order-pharmacy">💊 Pharmacy</button>
      </div>
      <p className="muted small">Deliver to</p>
      <div className="category-chips">
        <button className={`chip${destination === "here" ? " selected" : ""}`} onClick={() => setDestination("here")}>📍 Where I am</button>
        <button className={`chip${destination === "home" ? " selected" : ""}`} disabled={!home} onClick={() => setDestination("home")} data-testid="deliver-home">🏠 {home ? `My front door · ${home.name}` : "My front door (set a home first)"}</button>
      </div>
      <ul className="gig-board">
        {DELIVERY_MENU.filter((item) => item.shop === shop).map((item) => (
          <li key={item.id}>
            <span>{item.emoji}</span>
            <div>
              <strong>{item.name}</strong>
              <small>{item.blurb} · {item.hunger ? `hunger +${item.hunger}` : ""}{item.hunger && item.energy ? " · " : ""}{item.energy ? `energy +${item.energy}` : ""}</small>
              <b>{naira(item.price)}</b>
            </div>
            <button className="primary" disabled={Boolean(busy)} data-testid={`order-${item.id}`} onClick={() => void order(item)}>{busy === item.id ? "…" : "Order"}</button>
          </li>
        ))}
      </ul>
      <p className="muted small">A rider cycles your order over and waits; walk up and take it. Food stays in your hands until you eat it — sit at your dining table or sofa first for +{SEATED_MEAL_ENERGY} energy. Medicine is taken when you collect it. {naira(DELIVERY_FEE)} delivery fee · fictional items, game naira only.</p>
    </div>
  );
}

function PropertyApp({ properties, economy, onRefresh, onToast, onNavigate, onClose, hud, onInteriorChanged, onDesign, onDrone, plots }: Props) {
  const mine = properties.filter((listing) => listing.isMine);
  const invited = properties.filter((listing) => listing.hasGuestAccess && !listing.isMine);
  const freePlot = plots.find((plot) => plot.status === "available");
  const ownPlot = plots.find((plot) => plot.status === "mine");
  const [interior, setInterior] = useState<InteriorState | null>(null);
  const [busy, setBusy] = useState(false);
  const insideId = hud?.location === "interior" && !hud.previewOnly ? hud.propertyId : null;
  const insideOwned = insideId && mine.some((listing) => listing.id === insideId) ? insideId : null;

  useEffect(() => {
    if (!insideOwned) {
      setInterior(null);
      return;
    }
    api.interior(insideOwned).then(setInterior).catch(() => setInterior(null));
  }, [insideOwned, economy?.balance]);

  const run = async (label: string, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      onToast({ tone: "success", text: label });
      await onRefresh();
      if (insideOwned) setInterior(await api.interior(insideOwned));
      onInteriorChanged();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-section">
      <div className="home-card starter">
        <strong>Kayode Court Hostel</strong>
        <p className="muted">Free starter room · Kayode Animashaun Street · always available</p>
      </div>
      {mine.length === 0 && (
        <p>You don't rent or own a home yet. Visit the <strong>For Rent</strong> sign at Adebayo Court or the <strong>For Sale</strong> sign at Okoro Terrace.</p>
      )}
      {mine.map((listing) => (
        <div key={listing.id} className={`home-card ${listing.overdue ? "overdue" : ""}`}>
          <div className="row spread">
            <strong>{listing.name}</strong>
            {listing.isHome && <span className="pill">Home</span>}
          </div>
          <p className="muted">{listing.street} · {listing.tenureType === "owned" ? "Owned" : `Rented · ${naira(listing.rent)} every ${listing.intervalDays} days`}</p>
          {listing.tenureType === "rented" && (
            <>
              <p className={listing.overdue ? "warning" : ""}>Next payment: {dueText(listing.nextPaymentAt)}</p>
              {listing.overdue && <p className="warning">Grace period ends {dueText(listing.accessEndsAt)}. After that the tenancy ends and belongings return to your bag.</p>}
              <p className="muted small">Deposit held: {naira(listing.depositPaid)} · storage {listing.storageSlots} slots · {listing.graceDays}-day grace period</p>
            </>
          )}
          <div className="row wrap">
            <button className="secondary" onClick={() => { onNavigate({ point: listing.door, label: listing.name }); onClose(); }}>Navigate</button>
            <button className="secondary" onClick={() => onDrone(listing.id, listing.name)} data-testid={`drone-${listing.id}`}>🚁 Drone view</button>
            {!listing.isHome && <button className="secondary" disabled={busy} onClick={() => void run(`${listing.name} is now your home.`, () => api.setHome(listing.id))}>Set as home</button>}
            {listing.tenureType === "rented" && (
              <>
                <button className="primary" disabled={busy} onClick={() => void run(`Rent paid for ${listing.name}.`, () => api.renew(listing.id))}>Pay rent {naira(listing.rent)}</button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`End your tenancy at ${listing.name}? Furniture and stored items return to your bag. ${listing.overdue ? "The deposit is kept because rent is overdue." : `Your ${naira(listing.depositPaid)} deposit is refunded.`}`)) {
                      void run("Tenancy ended. Belongings returned to your bag.", () => api.cancelTenancy(listing.id));
                    }
                  }}
                >End tenancy</button>
              </>
            )}
          </div>
          <HomeServices propertyId={listing.id} inside={insideOwned === listing.id} onRefresh={onRefresh} onToast={onToast} />
        </div>
      ))}
      {insideOwned && interior && (
        <div className="interior-tools">
          <button className="primary wide" onClick={() => onDesign(insideOwned)} data-testid="design-home">🛋 Design this home — furniture, view from above, invite friends</button>
          {interior.furniture.length > 0 && <p className="muted small">{interior.furniture.length} piece{interior.furniture.length > 1 ? "s" : ""} of furniture placed{interior.availableFurniture.length ? ` · ${interior.availableFurniture.reduce((sum, item) => sum + item.available, 0)} more in your bag` : ""}.</p>}
          <h3>Storage chest · {interior.storage.reduce((total, item) => total + item.quantity, 0)}/{interior.storageSlots}</h3>
          {interior.storage.map((item) => (
            <div key={item.itemId} className="row spread">
              <span>{item.name} ×{item.quantity}</span>
              <button className="link" disabled={busy} onClick={() => void run(`${item.name} taken from storage.`, () => api.storage(insideOwned, item.itemId, "retrieve"))}>Take</button>
            </div>
          ))}
          {interior.carried.filter((item) => item.category !== "furniture").map((item) => (
            <div key={item.itemId} className="row spread">
              <span>{item.name} ×{item.available} (bag)</span>
              <button className="link" disabled={busy} onClick={() => void run(`${item.name} stored.`, () => api.storage(insideOwned, item.itemId, "store"))}>Store</button>
            </div>
          ))}
        </div>
      )}
      {!insideOwned && mine.length > 0 && <p className="muted small">Go inside your home to design it: drag furniture anywhere, see the room from above and invite friends round.</p>}
      {invited.length > 0 && (
        <>
          <h3>Homes you're invited to</h3>
          {invited.map((listing) => (
            <div key={listing.id} className="home-card">
              <strong>{listing.name}</strong>
              <p className="muted">{listing.street ?? listing.addressLabel} · the door opens for you</p>
              <button className="secondary" onClick={() => { onNavigate({ point: listing.door, label: listing.name }); onClose(); }}>Visit</button>
            </div>
          ))}
        </>
      )}
      <h3>New houses for sale</h3>
      <p className="muted small">Buy or lease an empty Lekki plot first, then choose what goes on it: a house (smallest to biggest, up to the helipad sky mansion) or your business. Walk to a plot's red sign.</p>
      <div className="house-catalogue">
        {HOUSE_DESIGNS.map((design) => (
          <div key={design.id} className="house-card">
            <strong>{design.name}</strong>
            <span>{design.bedrooms} bed · {design.floors} floor{design.floors > 1 ? "s" : ""}{design.parking ? ` · ${design.parking}-car carport` : ""}{design.pool ? " · pool" : ""}</span>
            <em>{naira(readyBuiltPrice(design))} built in one go · land extra</em>
          </div>
        ))}
      </div>
      {ownPlot ? (
        <button className="secondary" onClick={() => { const plot = plotById(ownPlot.id); if (plot) onNavigate({ point: plot.gate, label: plot.name }); onClose(); }}>Go to your plot</button>
      ) : freePlot ? (
        <button className="secondary" onClick={() => { const plot = plotById(freePlot.id); if (plot) onNavigate({ point: plot.gate, label: `${plot.name} · land for sale` }); onClose(); }}>Go to a free plot</button>
      ) : (
        <p className="muted small">Every plot is taken right now.</p>
      )}
    </div>
  );
}

function SettingsApp({ settings, onSettings, bindings, onBindings, quality, onQuality, onCustomise, onSignOut, playerName }: Props) {
  const [listening, setListening] = useState<Action | null>(null);
  useEffect(() => {
    if (!listening) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code !== "Escape") onBindings({ ...bindings, [listening]: event.code });
      setListening(null);
    };
    window.addEventListener("keydown", capture, { capture: true });
    return () => window.removeEventListener("keydown", capture, { capture: true });
  }, [listening, bindings, onBindings]);
  const slider = (key: keyof PlayerSettings, label: string, min: number, max: number, step: number) => (
    <label className="setting">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={settings[key] as number} onChange={(event) => onSettings({ ...settings, [key]: Number(event.target.value) })} />
    </label>
  );
  const toggle = (key: keyof PlayerSettings, label: string) => (
    <label className="setting toggle">
      <span>{label}</span>
      <input type="checkbox" checked={settings[key] as boolean} onChange={(event) => onSettings({ ...settings, [key]: event.target.checked })} />
    </label>
  );
  return (
    <div className="app-section settings">
      <h3>Appearance</h3>
      <div className="theme-switch" role="radiogroup" aria-label="Appearance">
        {(["light", "dark"] as const).map((theme) => (
          <button key={theme} role="radio" aria-checked={settings.theme === theme} className={`theme-option ${theme}`} onClick={() => onSettings({ ...settings, theme })}>
            <i aria-hidden="true" />
            {theme === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
      <h3>Controls</h3>
      {slider("mouseSensitivity", "Camera sensitivity", 0.2, 3, 0.1)}
      {toggle("invertY", "Invert camera Y")}
      {toggle("cameraRecentre", "Camera drifts back behind your vehicle")}
      <ul className="bindings">
        {(Object.keys(actionLabels) as Action[]).map((action) => (
          <li key={action}>
            <span>{actionLabels[action]}</span>
            <button className="key" onClick={() => setListening(action)}>{listening === action ? "Press a key…" : keyLabel(bindings[action])}</button>
          </li>
        ))}
      </ul>
      <h3>Street life</h3>
      {toggle("carSpotters", "Car spotters admire rare cars (simulated photos, never your camera)")}
      {toggle("streetEncounters", "Agbero roadside encounters (fictional touts asking for change)")}
      <h3>Audio & text</h3>
      {toggle("muted", "Mute all game sounds")}
      {slider("masterVolume", "Master volume", 0, 1, 0.05)}
      {slider("ambienceVolume", "Street ambience", 0, 1, 0.05)}
      {slider("dialogueVolume", "Announcements", 0, 1, 0.05)}
      {toggle("subtitles", "Subtitles")}
      {slider("textScale", "Text size", 0.85, 1.4, 0.05)}
      <h3>Graphics</h3>
      <label className="setting">
        <span>Quality</span>
        <select value={quality} onChange={(event) => onQuality(event.target.value)}>
          <option value="low">Low (fastest)</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <p className="muted small">Changing quality reloads the world. If your device runs out of graphics memory, the game steps down one level and tells you.</p>
      {toggle("autoGraphics", "Lower detail automatically when slow")}
      <p className="muted small">Steps down resolution, shadows and view distance while the frame rate stays under 30 fps, and restores them when it recovers. Turn this off to keep exactly the quality you picked.</p>
      <h3>Character</h3>
      <button className="secondary" onClick={onCustomise}>Customise character</button>
      <p className="muted small">The 3D resident currently uses one generated model for everyone; saved style choices are kept for the modular wardrobe.</p>
      <AccountSection playerName={playerName} onSignOut={onSignOut} />
    </div>
  );
}

function HelpApp({ onUnstuck, onReset, onClose, bindings }: Props) {
  const [confirming, setConfirming] = useState(false);
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  return (
    <div className="app-section">
      <h3>I am stuck</h3>
      <p className="muted">Moves you to the nearest safe spot (bus stop, hostel or hub). On a danfo it requests the next stop; indoors it takes you outside.</p>
      <button className="primary" onClick={() => { onUnstuck(); onClose(); }}>Get me unstuck</button>
      <h3>Controls</h3>
      <ul className="controls-list">
        <li><kbd>{keyLabel(bindings.forward)}{keyLabel(bindings.left)}{keyLabel(bindings.back)}{keyLabel(bindings.right)}</kbd> move (jog by default)</li>
        <li><kbd>{keyLabel(bindings.sprint)}</kbd> sprint · <kbd>{keyLabel(bindings.walk)}</kbd> walk toggle</li>
        <li>Mouse look (click the game to lock, <kbd>Esc</kbd> to release) · wheel zoom · drag also works</li>
        <li><kbd>{keyLabel(bindings.interact)}</kbd> interact · <kbd>{keyLabel(bindings.stop)}</kbd> request danfo stop</li>
        <li><kbd>{keyLabel(bindings.phone)}</kbd> phone · <kbd>{keyLabel(bindings.map)}</kbd> map · <kbd>{keyLabel(bindings.help)}</kbd> controls overlay</li>
      </ul>
      {local && (
        <>
          <h3>Testing</h3>
          {!confirming ? (
            <button className="danger" onClick={() => setConfirming(true)}>Reset test progress</button>
          ) : (
            <div className="row">
              <button className="danger" onClick={async () => { await onReset(); setConfirming(false); }}>Yes, reset everything</button>
              <button className="secondary" onClick={() => setConfirming(false)}>Keep my progress</button>
            </div>
          )}
          <p className="muted small">Local development only: clears wallet, jobs, tenancies, furniture and saved position for this account.</p>
        </>
      )}
    </div>
  );
}
