import { defaultSettings, districtAt, propertyPlace, type CharacterAppearance, type ChatMessage, type Notice, type SafetyStatus, type Place, type PlayerSettings, type SelfState, type Vec2 } from "@lagos-living/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, naira, type EconomyState, type MyVehicle, type PlotState, type PropertyListing } from "../api";
import { defaultBindings, keyLabel, type Bindings } from "../game/controller";
import { EngineDisposedError, GameEngine, type HudState, type Interaction } from "../game/engine";
import type { Quality } from "../game/materials";
import { FullMap, Minimap } from "./MapView";
import { currentObjective, housingPath, type HousingPath } from "./objectives";
import { Welcome } from "./Welcome";
import { Phone, type PhoneApp } from "./Phone";
import { COMMUNITY_KINDS, CommunitySheet } from "./CommunitySheets";
import { PlaceSheet } from "./Sheets";
import { PlotSheet } from "./PlotSheet";
import { DealershipSheet, MechanicSheet } from "./VehicleSheets";
import { ChatPanel, ReportDialog, WarningNotice, type ReportTarget } from "./SafetyUI";

type Toast = Notice & { id: number; at: number };

function loadBindings(): Bindings {
  try {
    return { ...defaultBindings, ...(JSON.parse(localStorage.getItem("lagos-bindings") ?? "{}") as Partial<Bindings>) };
  } catch {
    return defaultBindings;
  }
}

function loadQuality(): Quality {
  const stored = localStorage.getItem("lagos-quality");
  if (stored === "low" || stored === "medium" || stored === "high") return stored;
  return matchMedia("(pointer: coarse)").matches ? "low" : "medium";
}

function loadHousing(): HousingPath | "later" | null {
  const stored = localStorage.getItem("lagos-housing");
  return stored === "rent" || stored === "buy" || stored === "build" || stored === "later" ? stored : null;
}

function ago(at: number | null, now: number) {
  if (!at) return "Not saved yet";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  return seconds < 5 ? "Saved just now" : seconds < 60 ? `Saved ${seconds}s ago` : `Saved ${Math.round(seconds / 60)}m ago`;
}

export function GameView({
  playerName,
  appearance,
  onCustomise,
  onSignOut,
  onSuspended,
  overlayOpen,
}: {
  playerName: string;
  appearance: CharacterAppearance;
  onCustomise: () => void;
  onSignOut: () => void;
  onSuspended: (info: { reason: string; until: string | null }) => void;
  overlayOpen: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [loading, setLoading] = useState<{ text: string; progress: number } | null>({ text: "Preparing Lagos…", progress: 0 });
  const [fatal, setFatal] = useState<string | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [economy, setEconomy] = useState<EconomyState | null>(null);
  const [properties, setProperties] = useState<PropertyListing[]>([]);
  const [vehicles, setVehicles] = useState<MyVehicle[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [log, setLog] = useState<Array<Notice & { at: number }>>([]);
  const [subtitle, setSubtitle] = useState<{ text: string; kind: "speech" | "sound" } | null>(null);
  const [sheet, setSheet] = useState<Place | null>(null);
  const [plotSheet, setPlotSheet] = useState<string | null>(null);
  const [plots, setPlots] = useState<PlotState[]>([]);
  const [phone, setPhone] = useState<PhoneApp | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(() => !localStorage.getItem("lagos-help-seen"));
  const [guideHidden, setGuideHidden] = useState(() => localStorage.getItem("lagos-guide-hidden") === "1");
  const [guideOpen, setGuideOpen] = useState(true);
  const [housing, setHousing] = useState(loadHousing);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [plotsLoaded, setPlotsLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [settings, setSettings] = useState<PlayerSettings>(defaultSettings);
  const [bindings, setBindings] = useState<Bindings>(loadBindings);
  const [quality] = useState<Quality>(loadQuality);
  const [manualTarget, setManualTarget] = useState<{ point: Vec2; label: string } | null>(null);
  const [visitedHome, setVisitedHome] = useState(() => localStorage.getItem("lagos-visited-home") === "1");
  const touch = useMemo(() => matchMedia("(pointer: coarse)").matches, []);
  const toastId = useRef(0);
  const engineRef = useRef<GameEngine | null>(null);
  const [chat, setChat] = useState<Array<ChatMessage & { own: boolean }>>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [safety, setSafety] = useState<SafetyStatus | null>(null);
  const suspendedRef = useRef(onSuspended);
  suspendedRef.current = onSuspended;

  const toast = useCallback((notice: Notice) => {
    const id = ++toastId.current;
    const at = Date.now();
    setToasts((current) => [...current.slice(-3), { ...notice, id, at }]);
    setLog((current) => [...current.slice(-40), { ...notice, at }]);
    setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== id)), notice.tone === "error" ? 6500 : 4500);
  }, []);

  const refreshPlots = useCallback(async () => {
    try {
      const next = await api.plots();
      setPlots(next);
      setPlotsLoaded(true);
      engineRef.current?.setPlots(next);
    } catch {
      // Plots are refreshed again on the next change broadcast.
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextEconomy, nextProperties, nextVehicles] = await Promise.all([api.economy(), api.properties(), api.vehicles(), refreshPlots()]);
      setEconomy(nextEconomy);
      setProperties(nextProperties);
      setVehicles(nextVehicles);
    } catch (error) {
      toast({ tone: "error", text: `Could not refresh your progress: ${(error as Error).message}` });
    }
  }, [toast]);

  const handlers = useRef<{ interact: (interaction: Interaction) => void; self: (self: SelfState) => void }>({ interact: () => undefined, self: () => undefined });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const overlay = overlayRef.current!;
    let live = true;
    const instance = new GameEngine(
      canvas,
      overlay,
      {
        hud: setHud,
        notice: (notice) => {
          toast(notice);
          if (/Fare paid|stepped off/.test(notice.text)) void refresh();
        },
        subtitle: (text, kind = "speech") => {
          const shown = { text, kind };
          setSubtitle(shown);
          setTimeout(() => setSubtitle((current) => (current === shown ? null : current)), kind === "sound" ? 3000 : 5000);
        },
        interact: (interaction) => handlers.current.interact(interaction),
        self: (self) => handlers.current.self(self),
        saved: (at) => setSavedAt(at),
        loading: (text, progress) => setLoading(progress >= 1 ? null : { text, progress }),
        ready: () => setLoading(null),
        toggle: (panel) => {
          if (panel === "phone") setPhone((current) => (current ? null : "home"));
          if (panel === "map") setMapOpen((current) => !current);
          if (panel === "help") setHelpOpen((current) => !current);
        },
        chat: (message, own) => setChat((current) => [...current.slice(-59), { ...message, own }]),
        suspended: (info) => suspendedRef.current(info),
        plotsChanged: () => void refreshPlots(),
      },
      quality,
      defaultSettings,
      loadBindings(),
    );
    engineRef.current = instance;
    instance
      .start()
      .then(() => {
        if (!live) return;
        setEngine(instance);
        void refreshPlots();
      })
      .catch((error: Error) => {
        if (!live || error instanceof EngineDisposedError) return;
        console.error("Game start failed", error);
        setFatal(error.message || "The game could not start.");
      });
    void refresh();
    api.safety().then(setSafety).catch(() => undefined);
    api.settings().then((loaded) => {
      setSettings(loaded);
      instance.setSettings(loaded);
    }).catch(() => undefined);
    return () => {
      live = false;
      void instance.dispose();
      engineRef.current = null;
    };
  }, [quality, refresh, refreshPlots, toast]);

  const finishingAt = plots.find((plot) => plot.status === "mine" && plot.construction && !plot.construction.completed && plot.construction.stagesPaid === 4)?.construction?.stageReadyAt;
  useEffect(() => {
    if (!finishingAt) return;
    const timer = setTimeout(() => void refresh(), Math.max(0, Date.parse(finishingAt) - Date.now()) + 1500);
    return () => clearTimeout(timer);
  }, [finishingAt, refresh]);

  useEffect(() => {
    engine?.setAppearance(appearance);
  }, [engine, appearance]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--text-scale", String(settings.textScale));
  }, [settings.textScale]);

  const chosenPath = housing === "later" ? null : housing;
  const settledPath = housingPath(properties, plots, null);
  const objective = useMemo(() => currentObjective(economy, properties, plots, hud, visitedHome, chosenPath), [economy, properties, plots, hud, visitedHome, chosenPath]);
  const objectiveKey = objective ? `${objective.step}:${objective.title}` : "";
  useEffect(() => {
    if (objectiveKey) setGuideOpen(true);
  }, [objectiveKey]);
  useEffect(() => {
    if (economy && plotsLoaded && !loading && !settledPath && housing === null) setWelcomeOpen(true);
  }, [Boolean(economy), plotsLoaded, loading, settledPath, housing]);
  const chooseHousing = (path: HousingPath | null) => {
    const value = path ?? "later";
    localStorage.setItem("lagos-housing", value);
    localStorage.setItem("lagos-help-seen", "1");
    setHousing(value);
    setWelcomeOpen(false);
    setHelpOpen(false);
    setGuideHidden(false);
    localStorage.removeItem("lagos-guide-hidden");
    setManualTarget(null);
  };
  const target = manualTarget ?? objective?.target ?? null;

  useEffect(() => {
    engine?.setWaypoint(target);
  }, [engine, target?.point[0], target?.point[1], target?.label]);

  useEffect(() => {
    const job = economy?.activeJob;
    engine?.setDeliveryTarget(job ? { point: [job.destinationX, job.destinationZ], label: job.destinationLabel ?? "Delivery" } : null);
  }, [engine, economy?.activeJob?.id]);

  useEffect(() => {
    if (manualTarget && hud && Math.hypot(manualTarget.point[0] - hud.x, manualTarget.point[1] - hud.z) < 6) {
      setManualTarget(null);
      toast({ tone: "success", text: `Arrived: ${manualTarget.label}` });
    }
  }, [hud?.x, hud?.z]);

  const warnings = safety?.warnings ?? [];
  const blocking = Boolean(welcomeOpen || sheet || plotSheet || phone || mapOpen || overlayOpen || loading || fatal || reportTarget || warnings.length);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code !== "Enter" || chatOpen || blocking || !engine) return;
      if (target && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)) return;
      event.preventDefault();
      if (document.pointerLockElement) document.exitPointerLock();
      setChatOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen, blocking, engine]);

  const blockResident = useCallback((userName: string) => {
    api.block(userName)
      .then((next) => {
        setSafety(next);
        setChat((current) => current.filter((message) => message.own || message.userName !== userName));
        toast({ tone: "success", text: `${userName} is blocked. You will not see each other's chat. Undo in Phone → Safety.` });
      })
      .catch((error: Error) => toast({ tone: "error", text: error.message }));
  }, [toast]);
  useEffect(() => {
    engine?.setInputEnabled(!blocking);
  }, [engine, blocking]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Escape") return;
      if (plotSheet) setPlotSheet(null);
      else if (sheet) setSheet(null);
      else if (mapOpen) setMapOpen(false);
      else if (phone) setPhone(null);
      else if (helpOpen) setHelpOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, plotSheet, mapOpen, phone, helpOpen]);

  const moving = (hud?.speed ?? 0) > 1;
  useEffect(() => {
    if (!helpOpen || !moving || localStorage.getItem("lagos-help-seen")) return;
    const timer = setTimeout(() => {
      setHelpOpen(false);
      localStorage.setItem("lagos-help-seen", "1");
    }, 5000);
    return () => clearTimeout(timer);
  }, [helpOpen, moving]);

  handlers.current.interact = (interaction) => {
    if (interaction.kind === "place") {
      setSheet(interaction.place);
      void refresh();
      return;
    }
    if (interaction.kind === "plot") {
      setPlotSheet(interaction.plotId);
      void refresh();
      return;
    }
    if (interaction.kind === "delivery") {
      const job = economy?.activeJob;
      if (!job) return toast({ tone: "error", text: "No active delivery." });
      api.completeDelivery(job.id)
        .then((result) => {
          toast({ tone: "success", text: result.replayed ? "That parcel was already delivered." : `Delivered! +${naira(result.reward)} · balance ${naira(result.balance)}` });
          setSavedAt(Date.now());
          return refresh();
        })
        .catch((error: Error) => toast({ tone: "error", text: error.message }));
      return;
    }
    const propertyId = hud?.propertyId;
    if (interaction.spot === "bed") {
      api.sleep()
        .then((result) => {
          toast({ tone: "success", text: `You slept well. Energy ${result.energy}/100.` });
          return refresh();
        })
        .catch((error: Error) => toast({ tone: "error", text: error.message }));
    } else if (interaction.spot === "kitchen" && propertyId) {
      api.homeAction(propertyId, "cook")
        .then(() => {
          toast({ tone: "success", text: "You cooked a quick pot of rice and stew." });
          return refresh();
        })
        .catch((error: Error) => toast({ tone: "error", text: error.message }));
    } else if (interaction.spot === "storage") {
      setPhone("property");
    }
  };

  handlers.current.self = (self) => {
    void refresh();
    if (self.reason === "entered" && self.propertyId && self.propertyId !== "starter-home") {
      localStorage.setItem("lagos-visited-home", "1");
      setVisitedHome(true);
    }
    if (self.reason === "preview" && self.propertyId) toast({ tone: "info", text: "Preview mode — look around. You can rent from the banner at the top." });
  };

  const rentReminder = properties.find((listing) => listing.isMine && listing.tenureType === "rented" && listing.nextPaymentAt && new Date(listing.nextPaymentAt).getTime() - Date.now() < 86_400_000);
  const previewListing = hud?.previewOnly && hud.propertyId ? properties.find((listing) => listing.id === hud.propertyId) : null;
  const markers = target ? [{ point: target.point, label: target.label, kind: manualTarget ? ("waypoint" as const) : ("objective" as const) }] : [];

  return (
    <div className={`game-view ${touch ? "touch" : "pointer"}`}>
      <canvas ref={canvasRef} className="game-canvas" data-testid="game-canvas" />
      <div ref={overlayRef} className="world-tags" />
      {touch && engine && !blocking && !chatOpen && <TouchLook engine={engine} />}

      {loading && (
        <div className="loading-overlay" role="status">
          <div className="wordmark"><span>LL</span> LAGOS LIVING</div>
          <p>{loading.text}</p>
          <div className="progress"><i style={{ width: `${Math.round(loading.progress * 100)}%` }} /></div>
        </div>
      )}
      {fatal && (
        <div className="loading-overlay error" role="alert">
          <h2>The city could not load</h2>
          <p>{fatal}</p>
          <button className="primary" onClick={() => location.reload()}>Try again</button>
        </div>
      )}

      {hud && engine && engine.data && (
        <>
          <section className="hud-location" aria-live="polite" data-testid="current-location">
            <p className="eyebrow">{hud.location === "bus" ? `ABOARD ${hud.bus?.routeNumber ?? ""} DANFO` : hud.location === "interior" ? "INDOORS" : hud.vehicle ? "DRIVING ON" : "YOU ARE ON"}</p>
            <h2 className={hud.streetNamed || hud.location !== "street" ? "" : "unnamed"}>{hud.street}</h2>
            <p>{hud.district}</p>
          </section>

          <section className="hud-status">
            <div className="wallet" data-testid="wallet">
              <span>GAME NAIRA</span>
              <strong>{economy ? naira(economy.balance) : "…"}</strong>
            </div>
            {economy && (
              <div className="needs-mini" title="Hunger and energy">
                <i style={{ width: `${economy.needs.hunger}%` }} className="hunger" />
                <i style={{ width: `${economy.needs.energy}%` }} className="energy" />
              </div>
            )}
            <div className={`net ${hud.network}`} data-testid="network">
              <i /> {hud.network === "connected" ? `${hud.online} online` : hud.network === "connecting" ? "Connecting…" : hud.networkReason}
            </div>
            <div className="save-state" data-testid="save-state">✓ {ago(savedAt, now)}</div>
          </section>

          {objective && !guideHidden && (
            <section className={`objective ${guideOpen ? "open" : "collapsed"}`} data-testid="objective">
              <div className="objective-head">
                <button className="objective-toggle" onClick={() => setGuideOpen((open) => !open)} aria-expanded={guideOpen} aria-label={guideOpen ? "Collapse guide" : "Expand guide"}>
                  <span className="eyebrow">STEP {objective.step} OF {objective.total}</span>
                  <h3>{objective.title}</h3>
                </button>
                <button className="icon-button small-x" onClick={() => { setGuideHidden(true); localStorage.setItem("lagos-guide-hidden", "1"); }} aria-label="Hide guide">✕</button>
              </div>
              {guideOpen && <p>{objective.detail.replace(/press E\b/g, touch ? "tap ✋" : `press ${keyLabel(bindings.interact)}`)}</p>}
              {guideOpen && objective.choose && <button className="primary small-button" onClick={() => setWelcomeOpen(true)}>Choose where to live</button>}
              {target && hud.waypoint && <p className="distance">◆ {target.label} · {Math.round(hud.waypoint.distance)} m</p>}
            </section>
          )}
          {guideHidden && (
            <button className="guide-tab" onClick={() => { setGuideHidden(false); setGuideOpen(true); localStorage.removeItem("lagos-guide-hidden"); }}>Guide</button>
          )}

          {economy?.activeJob && (
            <div className="job-chip" data-testid="job-status">📦 Parcel for {economy.activeJob.destinationLabel} · {naira(economy.activeJob.reward)}</div>
          )}
          {rentReminder && (
            <button className="rent-reminder" onClick={() => setPhone("property")}>
              {rentReminder.overdue ? "Rent overdue" : "Rent due soon"} · {rentReminder.name} · {naira(rentReminder.rent)}
            </button>
          )}

          {hud.bus && (
            <section className="bus-panel" data-testid="bus-panel">
              <p className="eyebrow">{hud.bus.routeNumber} · {hud.bus.routeName}</p>
              <p>Seat <strong>{hud.bus.seat !== null ? hud.bus.seat + 1 : "—"}</strong> of {hud.bus.capacity} · fare paid</p>
              <p>{hud.bus.atStop ? <>Stopped: <strong>{hud.bus.atStop}</strong></> : <>Next stop: <strong>{hud.bus.nextStop}</strong></>}</p>
              <div className="row">
                <button className="secondary" disabled={hud.bus.stopRequested} onClick={() => engine.requestStop()}>{hud.bus.stopRequested ? "Stop requested" : `Request stop (${keyLabel(bindings.stop)})`}</button>
                <button className="primary" onClick={() => engine.alight()}>{hud.bus.atStop ? "Step off (E)" : "Step off at next stop"}</button>
              </div>
            </section>
          )}

          {hud.vehicle && (
            <section className={`speedometer ${hud.vehicle.limp ? "limp" : ""}`} data-testid="speedometer" aria-label="Speedometer">
              <div className="speed-readout">
                <strong>{hud.vehicle.kmh}</strong>
                <span>km/h{hud.vehicle.reversing ? " · R" : ""}</span>
              </div>
              <div className="speed-meta">
                <p><b>{hud.vehicle.name}</b> · <span className="plate">{hud.vehicle.plate}</span></p>
                <p className="condition-line">
                  Condition {hud.vehicle.condition}%{hud.vehicle.limp ? ` · LIMP MODE (max ${hud.vehicle.topKmh} km/h)` : ""}
                </p>
                <p className="muted small">
                  <kbd>{keyLabel(bindings.forward)}</kbd>/<kbd>{keyLabel(bindings.back)}</kbd> drive · <kbd>{keyLabel(bindings.left)}</kbd>/<kbd>{keyLabel(bindings.right)}</kbd> steer · <kbd>{keyLabel(bindings.jump)}</kbd> handbrake · <kbd>{keyLabel(bindings.stop)}</kbd> horn
                </p>
              </div>
            </section>
          )}

          {previewListing && (
            <section className="preview-banner">
              <div>
                <strong>Previewing {previewListing.name}</strong>
                <span>{naira(previewListing.rent)}/{previewListing.intervalDays} days + {naira(previewListing.deposit)} deposit = {naira(previewListing.upfrontRent)} upfront</span>
              </div>
              <button className="primary" onClick={() => setSheet(engine && properties.length ? ({ ...placeFromListing(previewListing) }) : null)}>See terms</button>
              <button className="secondary" onClick={() => engine.exitProperty()}>Leave</button>
            </section>
          )}

          {hud.prompt && !blocking && (
            <button type="button" className={`prompt ${hud.prompt.disabled ? "disabled" : ""}`} data-testid="prompt" disabled={hud.prompt.disabled} onClick={() => engine.triggerInteract()}>
              <kbd>{touch && !hud.prompt.disabled ? "✋" : hud.prompt.key}</kbd>
              <div>
                <strong>{hud.prompt.label}</strong>
                {hud.prompt.detail && <span>{hud.prompt.detail}</span>}
              </div>
            </button>
          )}
          {hud.secondaryPrompt && !blocking && (
            <div className="prompt secondary-prompt">
              <kbd>{hud.secondaryPrompt.key}</kbd>
              <strong>{hud.secondaryPrompt.label}</strong>
            </div>
          )}

          {subtitle && settings.subtitles && (
            <div className={`subtitle ${subtitle.kind}`} role="status" data-testid="subtitle">
              {subtitle.kind === "sound" ? `[${subtitle.text}]` : `“${subtitle.text}”`}
            </div>
          )}

          <Minimap engine={engine} data={engine.data} markers={markers} onOpen={() => setMapOpen(true)} />

          <div className="hud-buttons">
            <button onClick={() => setPhone("home")} aria-label="Open phone">📱<span> Phone</span> <kbd>{keyLabel(bindings.phone)}</kbd></button>
            <button onClick={() => setMapOpen(true)} aria-label="Open map">🗺<span> Map</span> <kbd>{keyLabel(bindings.map)}</kbd></button>
            {touch && <button onClick={() => setChatOpen(true)} aria-label="Open chat">💬<span> Chat</span></button>}
            {!touch && <button onClick={() => setHelpOpen((open) => !open)} aria-label="Controls">⌨<span> Controls</span> <kbd>{keyLabel(bindings.help)}</kbd></button>}
          </div>
          <div className="perf" data-testid="perf">{hud.fps} fps · {hud.frameMs} ms · {hud.qualityStep ? `auto detail −${hud.qualityStep} · ` : ""}{hud.speed.toFixed(1)} m/s {hud.mode}</div>
          <div className="osm-credit">Map data © OpenStreetMap contributors (ODbL)</div>
        </>
      )}

      {hud && engine && (
        <ChatPanel
          messages={chat}
          open={chatOpen}
          onOpen={() => setChatOpen(true)}
          onClose={() => setChatOpen(false)}
          onSend={(text) => {
            if (engine.sendChat(text)) return true;
            toast({ tone: "error", text: "Not connected — your message was not sent." });
            return false;
          }}
          onReport={setReportTarget}
          onBlock={blockResident}
        />
      )}
      {reportTarget && <ReportDialog target={reportTarget} onClose={() => setReportTarget(null)} onToast={toast} />}
      {warnings.length > 0 && !loading && (
        <WarningNotice
          warnings={warnings}
          onAcknowledge={() => api.acknowledgeWarnings().then(setSafety).catch((error: Error) => toast({ tone: "error", text: error.message }))}
        />
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((entry) => (
          <div key={entry.id} className={`toast ${entry.tone}`}>{entry.text}</div>
        ))}
      </div>

      {helpOpen && !loading && !touch && !welcomeOpen && (
        <aside className="controls-card">
          <div className="row spread">
            <h3>Controls</h3>
            <button className="icon-button" onClick={() => { setHelpOpen(false); localStorage.setItem("lagos-help-seen", "1"); }} aria-label="Close controls">✕</button>
          </div>
          <ul>
            <li><kbd>{keyLabel(bindings.forward)}</kbd><kbd>{keyLabel(bindings.left)}</kbd><kbd>{keyLabel(bindings.back)}</kbd><kbd>{keyLabel(bindings.right)}</kbd> Jog (3.5 m/s)</li>
            <li><kbd>{keyLabel(bindings.sprint)}</kbd> Sprint (6 m/s) · <kbd>{keyLabel(bindings.walk)}</kbd> Walk (1.5 m/s)</li>
            <li><kbd>Mouse</kbd> Look — click to lock, <kbd>Esc</kbd> to release</li>
            <li><kbd>{keyLabel(bindings.interact)}</kbd> Interact · <kbd>{keyLabel(bindings.stop)}</kbd> Request danfo stop</li>
            <li>In your car: <kbd>{keyLabel(bindings.forward)}</kbd>/<kbd>{keyLabel(bindings.back)}</kbd> accelerate/brake, <kbd>{keyLabel(bindings.jump)}</kbd> handbrake, <kbd>{keyLabel(bindings.interact)}</kbd> step out</li>
            <li><kbd>{keyLabel(bindings.phone)}</kbd> Phone · <kbd>{keyLabel(bindings.map)}</kbd> Map · <kbd>{keyLabel(bindings.help)}</kbd> This card</li>
          </ul>
          <p className="muted small">Signed in as {playerName}. Stuck? Phone → Help → “Get me unstuck”.</p>
        </aside>
      )}

      {sheet?.kind === "dealership" && (
        <DealershipSheet
          place={sheet}
          economy={economy}
          vehicles={vehicles}
          onClose={() => setSheet(null)}
          onRefresh={refresh}
          onToast={toast}
          onBought={(vehicle) => {
            setSheet(null);
            if (vehicle.x !== null && vehicle.z !== null) setManualTarget({ point: [vehicle.x, vehicle.z], label: `Your ${vehicle.modelName}` });
          }}
        />
      )}
      {sheet?.kind === "mechanic" && (
        <MechanicSheet place={sheet} economy={economy} vehicles={vehicles} onClose={() => setSheet(null)} onRefresh={refresh} onToast={toast} />
      )}
      {sheet && COMMUNITY_KINDS.has(sheet.kind) && (
        <CommunitySheet place={sheet} economy={economy} onClose={() => setSheet(null)} onRefresh={refresh} onToast={toast} />
      )}
      {sheet && sheet.kind !== "dealership" && sheet.kind !== "mechanic" && !COMMUNITY_KINDS.has(sheet.kind) && (
        <PlaceSheet
          place={sheet}
          economy={economy}
          properties={properties}
          onClose={() => setSheet(null)}
          onRefresh={async () => {
            await refresh();
            setSavedAt(Date.now());
          }}
          onToast={toast}
          onEnter={(propertyId, mode) => engine?.enterProperty(propertyId, mode)}
          onJobStarted={() => setManualTarget(null)}
          focusListingId={hud?.previewOnly ? hud.propertyId : null}
        />
      )}

      {plotSheet && (
        <PlotSheet
          plotId={plotSheet}
          state={plots.find((plot) => plot.id === plotSheet) ?? null}
          economy={economy}
          now={now}
          onClose={() => setPlotSheet(null)}
          onRefresh={async () => {
            await refresh();
            setSavedAt(Date.now());
          }}
          onToast={toast}
          onEnter={(propertyId) => engine?.enterProperty(propertyId, "enter")}
        />
      )}

      {phone && engine && (
        <Phone
          app={phone}
          setApp={setPhone}
          onClose={() => setPhone(null)}
          economy={economy}
          properties={properties}
          vehicles={vehicles}
          hud={hud}
          notices={log}
          settings={settings}
          bindings={bindings}
          quality={quality}
          onSettings={(next) => {
            setSettings(next);
            engine.setSettings(next);
            api.saveSettings(next).catch((error: Error) => toast({ tone: "error", text: `Settings not saved: ${error.message}` }));
          }}
          onBindings={(next) => {
            setBindings(next);
            engine.setBindings(next);
            localStorage.setItem("lagos-bindings", JSON.stringify(next));
          }}
          onQuality={(next) => {
            localStorage.setItem("lagos-quality", next);
            location.reload();
          }}
          onNavigate={(next) => setManualTarget(next)}
          onOpenMap={() => { setPhone(null); setMapOpen(true); }}
          onRefresh={refresh}
          onToast={toast}
          onUnstuck={() => engine.unstuck()}
          onReset={async () => {
            try {
              await api.resetProgress();
              localStorage.removeItem("lagos-visited-home");
              localStorage.removeItem("lagos-guide-hidden");
              localStorage.removeItem("lagos-housing");
              toast({ tone: "success", text: "Test progress reset. Reloading…" });
              setTimeout(() => location.reload(), 900);
            } catch (error) {
              toast({ tone: "error", text: (error as Error).message });
            }
          }}
          onEat={async (itemId) => {
            try {
              const result = await api.eat(itemId);
              toast({ tone: "success", text: `You ate ${result.name}. Hunger ${result.needs.hunger}/100.` });
              await refresh();
            } catch (error) {
              toast({ tone: "error", text: (error as Error).message });
            }
          }}
          onInteriorChanged={() => void engine.refreshInterior()}
          onReport={(target) => { setPhone(null); setReportTarget(target); }}
          onCustomise={() => { setPhone(null); onCustomise(); }}
          onSignOut={onSignOut}
          playerName={playerName}
        />
      )}

      {mapOpen && engine?.data && (
        <FullMap engine={engine} data={engine.data} markers={markers} onNavigate={(next) => setManualTarget(next)} onClose={() => setMapOpen(false)} />
      )}

      {touch && engine && !blocking && !chatOpen && <TouchControls engine={engine} />}

      {welcomeOpen && !loading && (
        <Welcome playerName={playerName} economy={economy} properties={properties} touch={touch} bindings={bindings} onChoose={chooseHousing} />
      )}
    </div>
  );
}

function placeFromListing(listing: PropertyListing): Place {
  const mapped = propertyPlace(listing.id);
  if (mapped) return mapped;
  return {
    id: listing.id,
    kind: listing.listingType === "sale" ? "sale" : "rental",
    name: listing.name,
    street: listing.street ?? "",
    district: districtAt(listing.door[0], listing.door[1])?.id ?? "lekki-phase-1",
    buildingId: null,
    door: listing.door,
    facade: listing.door,
    facing: 0,
    frontage: 0,
    kerb: listing.door,
    kerbYaw: 0,
  };
}

/** Drag anywhere on the open view to look around; sits under the HUD so buttons stay tappable. */
function TouchLook({ engine }: { engine: GameEngine }) {
  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const end = (event: React.PointerEvent) => {
    if (look.current?.id === event.pointerId) look.current = null;
  };
  return (
    <div
      className="touch-look"
      onPointerDown={(event) => {
        if (look.current) return;
        look.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (look.current?.id !== event.pointerId) return;
        engine.touchLook((event.clientX - look.current.x) * 1.6, (event.clientY - look.current.y) * 1.6);
        look.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    />
  );
}

function TouchControls({ engine }: { engine: GameEngine }) {
  const base = useRef<{ id: number; x: number; y: number } | null>(null);
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const [sprint, setSprint] = useState(false);
  const [used, setUsed] = useState(() => localStorage.getItem("lagos-stick-used") === "1");
  const release = (event: React.PointerEvent) => {
    if (base.current?.id !== event.pointerId) return;
    base.current = null;
    setKnob([0, 0]);
    engine.setTouchMove(0, 0, false);
  };
  useEffect(() => () => engine.setTouchMove(0, 0, false), [engine]);
  return (
    <>
      <div
        className="touch-stick"
        onPointerDown={(event) => {
          if (base.current) return;
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          base.current = { id: event.pointerId, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          if (!used) {
            setUsed(true);
            localStorage.setItem("lagos-stick-used", "1");
          }
        }}
        onPointerMove={(event) => {
          if (base.current?.id !== event.pointerId) return;
          const radius = (event.currentTarget as HTMLElement).clientWidth / 2;
          const dx = (event.clientX - base.current.x) / radius;
          const dy = (event.clientY - base.current.y) / radius;
          const length = Math.min(1, Math.hypot(dx, dy));
          const angle = Math.atan2(dy, dx);
          const x = Math.cos(angle) * length;
          const y = Math.sin(angle) * length;
          setKnob([x * radius * 0.6, y * radius * 0.6]);
          engine.setTouchMove(x, -y, sprint || length > 0.98);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <i style={{ transform: `translate(calc(-50% + ${knob[0]}px), calc(-50% + ${knob[1]}px))` }} />
        {!used && <span className="touch-hint">Drag to walk</span>}
      </div>
      <div className="touch-buttons">
        <button className={sprint ? "run active" : "run"} onClick={() => setSprint((value) => !value)} aria-pressed={sprint}>Run</button>
        <button className="use" onClick={() => engine.triggerInteract()} aria-label="Use">✋</button>
      </div>
    </>
  );
}
