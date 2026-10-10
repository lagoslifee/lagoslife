import { nearestStop, ROUTES, type RideState, type Notice, type PlayerSettings, type Vec2 } from "@lagos-living/shared";
import { useEffect, useState } from "react";
import { api, naira, type EconomyState, type InteriorState, type MyVehicle, type PropertyListing } from "../api";
import { actionLabels, keyLabel, type Action, type Bindings } from "../game/controller";
import type { GameEngine, HudState } from "../game/engine";
import { RideApp } from "./RideApp";
import { CommunityApp } from "./CommunitySheets";
import { VehiclesApp } from "./VehicleSheets";
import { JusticeApp, SafetyApp, type ReportTarget } from "./SafetyUI";

export type PhoneApp = "home" | "map" | "ride" | "transport" | "jobs" | "wallet" | "property" | "vehicles" | "community" | "justice" | "safety" | "friends" | "notifications" | "settings" | "help";

const APPS: Array<{ id: PhoneApp; label: string; icon: string }> = [
  { id: "map", label: "Map", icon: "🗺" },
  { id: "ride", label: "Ride", icon: "🚕" },
  { id: "transport", label: "Transport", icon: "🚌" },
  { id: "jobs", label: "Jobs", icon: "📦" },
  { id: "wallet", label: "Wallet", icon: "₦" },
  { id: "property", label: "My Home", icon: "🏠" },
  { id: "vehicles", label: "Vehicles", icon: "🚗" },
  { id: "community", label: "Community", icon: "🤝" },
  { id: "justice", label: "Justice", icon: "⚖" },
  { id: "safety", label: "Safety", icon: "🛡" },
  { id: "friends", label: "Friends", icon: "👥" },
  { id: "notifications", label: "Alerts", icon: "🔔" },
  { id: "settings", label: "Settings", icon: "⚙" },
  { id: "help", label: "Help", icon: "?" },
];

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
  onReport: (target: ReportTarget) => void;
  onCustomise: () => void;
  onSignOut: () => void;
  playerName: string;
  engine: GameEngine | null;
  ride: RideState | null;
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
  const title = APPS.find((entry) => entry.id === app)?.label ?? "Phone";
  return (
    <aside className="phone" role="dialog" aria-label="Phone">
      <div className="phone-status">
        <span>{new Date().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</span>
        <span>{props.economy ? naira(props.economy.balance) : "…"}</span>
      </div>
      <header className="phone-header">
        {app !== "home" ? <button className="icon-button" onClick={() => setApp("home")} aria-label="Back">‹</button> : <span />}
        <h2>{app === "home" ? "Phone" : title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close phone">✕</button>
      </header>
      <div className="phone-body">
        {app === "home" && (
          <div className="app-grid">
            {APPS.map((entry) => (
              <button key={entry.id} className="app-icon" onClick={() => (entry.id === "map" ? props.onOpenMap() : setApp(entry.id))}>
                <span>{entry.icon}</span>
                {entry.label}
                {entry.id === "property" && props.properties.some((listing) => listing.isMine && (days(listing.nextPaymentAt) ?? 9) < 2) && <i className="badge" />}
              </button>
            ))}
          </div>
        )}
        {app === "ride" && <RideApp engine={props.engine} ride={props.ride} properties={props.properties} onNavigate={props.onNavigate} onClose={onClose} />}
        {app === "transport" && <TransportApp {...props} />}
        {app === "jobs" && <JobsApp {...props} />}
        {app === "wallet" && <WalletApp {...props} />}
        {app === "property" && <PropertyApp {...props} />}
        {app === "vehicles" && (
          <VehiclesApp
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
        {app === "friends" && (
          <div className="app-section">
            <p><strong>{props.hud?.online ?? 1}</strong> resident{props.hud?.online === 1 ? "" : "s"} online in this world.</p>
            <p className="muted">Name tags show nearby residents. Press Enter to chat with anyone within 40 m. Friend lists are not available yet.</p>
          </div>
        )}
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
    </aside>
  );
}

function TransportApp({ hud, onNavigate, onClose }: Props) {
  const nearest = hud ? nearestStop(hud.x, hud.z) : null;
  const routes = nearest ? [nearest.route, ...ROUTES.filter((route) => route !== nearest.route)] : ROUTES;
  return (
    <div className="app-section">
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

function JobsApp({ economy, onNavigate, onClose, onRefresh, onToast }: Props) {
  const job = economy?.activeJob;
  return (
    <div className="app-section">
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

function PropertyApp({ properties, economy, onRefresh, onToast, onNavigate, onClose, hud, onInteriorChanged }: Props) {
  const mine = properties.filter((listing) => listing.isMine);
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
        </div>
      ))}
      {insideOwned && interior && (
        <div className="interior-tools">
          <h3>Furniture</h3>
          {interior.availableFurniture.length === 0 && <p className="muted">No spare furniture in your bag. Buy some at Home & Style Furnishings.</p>}
          {interior.availableFurniture.map((item) => (
            <div key={item.itemId} className="row spread">
              <span>{item.name} ×{item.available}</span>
              <button
                className="link"
                disabled={busy}
                onClick={() => {
                  const taken = new Set(interior.furniture.map((placement) => `${placement.gridX}:${placement.gridZ}`));
                  const cells: Array<[number, number]> = [[2, 2], [5, 2], [2, 4], [5, 4], [1, 3], [6, 3], [3, 1], [4, 4]];
                  const cell = cells.find(([x, z]) => !taken.has(`${x}:${z}`));
                  if (!cell) return onToast({ tone: "error", text: "No free floor space left." });
                  void run(`${item.name} placed.`, () => api.placeFurniture(insideOwned, item.itemId, cell[0], cell[1], 0));
                }}
              >Place</button>
            </div>
          ))}
          {interior.furniture.map((placement) => (
            <div key={placement.id} className="row spread">
              <span>{placement.name} (placed)</span>
              <button className="link" disabled={busy} onClick={() => void run(`${placement.name} picked up.`, () => api.removeFurniture(insideOwned, placement.id))}>Pick up</button>
            </div>
          ))}
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
      {!insideOwned && mine.length > 0 && <p className="muted small">Furniture and storage can be managed while you are inside your home.</p>}
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
      <h3>Controls</h3>
      {slider("mouseSensitivity", "Camera sensitivity", 0.2, 3, 0.1)}
      {toggle("invertY", "Invert camera Y")}
      <ul className="bindings">
        {(Object.keys(actionLabels) as Action[]).map((action) => (
          <li key={action}>
            <span>{actionLabels[action]}</span>
            <button className="key" onClick={() => setListening(action)}>{listening === action ? "Press a key…" : keyLabel(bindings[action])}</button>
          </li>
        ))}
      </ul>
      <h3>Audio & text</h3>
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
      <p className="muted small">Changing quality reloads the world.</p>
      {toggle("autoGraphics", "Lower detail automatically when slow")}
      <p className="muted small">Steps down resolution, shadows and view distance while the frame rate stays under 30 fps, and restores them when it recovers.</p>
      <h3>Character</h3>
      <button className="secondary" onClick={onCustomise}>Customise character</button>
      <p className="muted small">The 3D resident currently uses one generated model for everyone; saved style choices are kept for the modular wardrobe.</p>
      <h3>Account</h3>
      <p>Signed in as <strong>{playerName}</strong></p>
      <button className="secondary" onClick={onSignOut}>Sign out</button>
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
