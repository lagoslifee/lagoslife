import { CLUBS, OFFENCES, ROBBERY, defaultSettings, type CheckpointStop, type HoldUp, type ClubTable, districtAt, propertyPlace, type CharacterAppearance, type ChatMessage, type Notice, type SafetyStatus, type Place, type PlayerSettings, type TravelInterior, type TripState, type TravelPrompt, type AgberoEncounter, type RideState, type SelfState, type TowState, type Vec2, TOW_STAGE_LABEL } from "@lagos-living/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, naira, type EconomyState, type MyVehicle, type PlotState, type PropertyListing } from "../api";
import { noteFps, report, setReportedQuality } from "../diagnostics";
import { defaultBindings, keyLabel, type Bindings } from "../game/controller";
import { describeTurn, turnArrow } from "../game/navigation";
import { EngineDisposedError, GameEngine, VEHICLE_VIEW_LABEL, type HudState, type Interaction } from "../game/engine";
import type { Quality } from "../game/materials";
import { FullMap, Minimap } from "./MapView";
import { currentObjective, housingPath, type HousingPath } from "./objectives";
import { Welcome } from "./Welcome";
import { Phone, type PhoneApp } from "./Phone";
import { TravelPromptCard } from "./GoApp";
import { AgberoPrompt } from "./AgberoPrompt";
import { ClubRadio } from "./ClubRadio";
import { ClubBarSheet, ClubDoorSheet, ClubTableSheet } from "./ClubSheets";
import { COMMUNITY_KINDS, CommunitySheet } from "./CommunitySheets";
import { PlaceSheet } from "./Sheets";
import { ExcursionPanel, FlightPanel, LOCAL_PHOTOS_KEY, TRAVEL_SHEET_KINDS, TravelPlaceSheet, TravelSpotSheet, loadLocalPhotos, tripHint } from "./TravelSheets";
import { PlotSheet } from "./PlotSheet";
import { DealershipSheet, MechanicSheet } from "./VehicleSheets";
import { CheckpointPrompt, HoldUpPrompt, PoliceStationSheet, SecuritySheet } from "./PoliceSheets";
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

/** Netlify adds its own badge in the bottom-right corner of netlify.app sites. */
const HOST_BADGE = location.hostname.endsWith(".netlify.app");

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
  const canvasHostRef = useRef<HTMLDivElement>(null);
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
  const [travelSpot, setTravelSpot] = useState<{ interior: TravelInterior; spot: string } | null>(null);
  const [trip, setTrip] = useState<TripState | null>(null);
  const [clubBar, setClubBar] = useState<Place | null>(null);
  const [clubTable, setClubTable] = useState<number | null>(null);
  const [clubTables, setClubTables] = useState<ClubTable[]>([]);
  const [checkpoint, setCheckpoint] = useState<CheckpointStop | null>(null);
  const [travelPrompts, setTravelPrompts] = useState<TravelPrompt[]>([]);
  const [agbero, setAgbero] = useState<AgberoEncounter | null>(null);
  const [holdUp, setHoldUp] = useState<HoldUp | null>(null);
  const [robTarget, setRobTarget] = useState<{ sessionId: string; name: string } | null>(null);
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
  const [quality, setQuality] = useState<Quality>(loadQuality);
  useEffect(() => setReportedQuality(quality), [quality]);
  const [restarts, setRestarts] = useState(0);
  const restartsRef = useRef(0);
  const [graphicsPaused, setGraphicsPaused] = useState(false);
  const lostTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lowered = useRef<{ from: Quality; to: Quality } | null>(null);
  /** Rebuilds the 3D view in place (same session, same server connection afterwards) one quality step lower. */
  const restartGraphics = useCallback((why: string) => {
    clearTimeout(lostTimer.current);
    setGraphicsPaused(false);
    if (restartsRef.current >= 3) {
      setFatal(
        `${why} Close any other tab with Lagos Living open, then press Try again. If it still fails, fully quit and reopen the browser: browsers switch 3D graphics off for a site after the graphics driver crashes, until they restart.`,
      );
      return;
    }
    restartsRef.current += 1;
    setFatal(null);
    setEngine(null);
    setQuality((current) => {
      const next: Quality = current === "high" ? "medium" : "low";
      if (next !== current) lowered.current = { from: current, to: next };
      localStorage.setItem("lagos-quality", next);
      return next;
    });
    setRestarts(restartsRef.current);
  }, []);
  const [manualTarget, setManualTarget] = useState<{ point: Vec2; label: string } | null>(null);
  const [quietObjective, setQuietObjective] = useState<string | null>(null);
  const [arrival, setArrival] = useState<{ label: string; at: number } | null>(null);
  const [ride, setRide] = useState<RideState | null>(null);
  const [tows, setTows] = useState<TowState[]>([]);
  const towsRef = useRef<TowState[]>([]);
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

  const previewVehicle = useCallback((choice: { modelId: string; colour: string } | null) => engine?.showcaseVehicle(choice), [engine]);
  const toast = useCallback((notice: Notice) => {
    const id = ++toastId.current;
    const at = Date.now();
    setToasts((current) => [...current.slice(-3), { ...notice, id, at }]);
    setLog((current) => [...current.slice(-40), { ...notice, at }]);
    setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== id)), notice.tone === "error" ? 6500 : 4500);
  }, []);

  useEffect(() => {
    if (!engine || !lowered.current) return;
    const { from, to } = lowered.current;
    lowered.current = null;
    const label = (quality: Quality) => quality[0]!.toUpperCase() + quality.slice(1);
    toast({ tone: "info", text: `Your device ran out of graphics memory, so graphics went from ${label(from)} to ${label(to)}. You can change this in Phone → Settings.` });
  }, [engine, toast]);

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

  // One playing tab per browser: two copies of the city exhaust a phone's graphics memory.
  const [elsewhere, setElsewhere] = useState(false);
  const tabId = useMemo(() => crypto.randomUUID(), []);
  const hasChannel = "BroadcastChannel" in window;
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [claimed, setClaimed] = useState(!hasChannel);
  const claimedAt = useRef(0);
  useEffect(() => {
    if (!hasChannel) return;
    const channel = new BroadcastChannel("lagos-living-tab");
    channelRef.current = channel;
    // Only a newer claim takes over, so a page that is reloading or closing can never pause its replacement.
    channel.onmessage = (event: MessageEvent<{ type: string; id: string; at?: number }>) => {
      if (event.data.type === "claim" && event.data.id !== tabId && (event.data.at ?? 0) >= claimedAt.current) {
        setEngine(null);
        setElsewhere(true);
      }
    };
    claimedAt.current = Date.now();
    channel.postMessage({ type: "claim", id: tabId, at: claimedAt.current });
    // Give the other tab a moment to release its graphics before this one allocates.
    const timer = setTimeout(() => setClaimed(true), 400);
    return () => {
      clearTimeout(timer);
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [hasChannel, tabId]);
  const playHere = () => {
    claimedAt.current = Date.now();
    channelRef.current?.postMessage({ type: "claim", id: tabId, at: claimedAt.current });
    setClaimed(false);
    setElsewhere(false);
    setTimeout(() => setClaimed(true), 400);
  };

  useEffect(() => {
    if (elsewhere || !claimed) return;
    // A fresh canvas per start: a canvas keeps its first (possibly lost) WebGL context for life.
    const canvas = document.createElement("canvas");
    canvas.className = "game-canvas";
    canvas.dataset.testid = "game-canvas";
    canvasHostRef.current!.appendChild(canvas);
    const overlay = overlayRef.current!;
    let live = true;
    const instance = new GameEngine(
      canvas,
      overlay,
      {
        hud: (next) => {
          setHud(next);
          noteFps(next.fps);
        },
        notice: (notice) => {
          toast(notice);
          if (/Fare paid|stepped off|Bike unlocked|Bike docked|Ade Recovery/.test(notice.text)) void refresh();
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
        graphics: (event) => {
          report(event === "restored" ? "context-restored" : "context-lost", event, { detail: { quality } });
          if (event === "restored") {
            clearTimeout(lostTimer.current);
            setGraphicsPaused(false);
          } else if (event === "lost") {
            setGraphicsPaused(true);
            clearTimeout(lostTimer.current);
            lostTimer.current = setTimeout(() => restartGraphics("Graphics did not come back."), 6_000);
          } else {
            restartGraphics("The game hit repeated errors.");
          }
        },
        tows: (next) => {
          const current = towsRef.current;
          if (next.some((tow) => current.find((entry) => entry.id === tow.id)?.stage !== tow.stage)) void refresh();
          for (const tow of next) {
            const before = current.find((entry) => entry.id === tow.id);
            if (tow.stage === "delivered" && before && before.stage !== "delivered" && tow.point) {
              setManualTarget({ point: tow.point, label: `Your ${tow.modelName}` });
            }
          }
          towsRef.current = next.filter((tow) => tow.stage !== "cancelled");
          setTows(towsRef.current);
        },
        police: (event) => {
          if (event.type === "checkpoint") setCheckpoint(event.stop);
          if (event.type === "checkpointEnd") setCheckpoint(null);
          if (event.type === "holdUp") setHoldUp(event.holdUp);
          if (event.type === "holdUpEnd") {
            setHoldUp(null);
            void refresh();
          }
        },
        trip: (next) => {
          setTrip(next);
          setTravelSpot(null);
          void refresh();
        },
        photo: (photo) => void savePhoto(photo),
        agbero: (encounter) => {
          setAgbero(encounter);
          if (!encounter) void refresh();
        },
        arrived: (label) => setArrival({ label, at: Date.now() }),
        travelPrompt: (prompt) => setTravelPrompts((list) => [...list.filter((entry) => entry.requestId !== prompt.requestId), prompt].slice(-3)),
        ride: (next) => {
          setRide(next);
          if (next && (next.status === "approaching" || next.status === "completed" || next.status === "cancelled")) void refresh();
        },
      },
      quality,
      defaultSettings,
      loadBindings(),
      restartsRef.current >= 2,
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
        // A GPU that just dropped a context (common on phones after a freeze) often refuses textures for a moment.
        if (/texture|webgl|context|shader|gpu/i.test(error.message) && restartsRef.current < 3) {
          setTimeout(() => live && restartGraphics("Graphics could not start."), 1_500);
          return;
        }
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
      void instance.dispose().finally(() => canvas.remove());
      engineRef.current = null;
    };
  }, [quality, restarts, refresh, refreshPlots, toast, restartGraphics, elsewhere, claimed]);

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
  const rideTarget =
    ride?.status === "approaching" || ride?.status === "waiting"
      ? { point: ride.pickup, label: `Pickup · ${ride.driverName}` }
      : ride?.status === "riding"
        ? { point: ride.dropoff, label: ride.label }
        : null;
  const objectiveRoute = objective?.target && objectiveKey !== quietObjective ? objective.target : null;
  const target = rideTarget ?? manualTarget ?? objectiveRoute;
  const endRoute = () => {
    setManualTarget(null);
    setQuietObjective(objectiveKey);
  };

  useEffect(() => {
    engine?.setWaypoint(target);
  }, [engine, target?.point[0], target?.point[1], target?.label]);

  useEffect(() => {
    const job = economy?.activeJob;
    engine?.setDeliveryTarget(job ? { point: [job.destinationX, job.destinationZ], label: job.destinationLabel ?? "Delivery" } : null);
  }, [engine, economy?.activeJob?.id]);

  // Arriving ends the route outright; the objective's own route only comes back when the step changes or on request.
  useEffect(() => {
    if (!arrival) return;
    if (!rideTarget) endRoute();
    toast({ tone: "success", text: `You have arrived at ${arrival.label}` });
  }, [arrival]);

  const warnings = safety?.warnings ?? [];
  const blocking = Boolean(welcomeOpen || sheet || plotSheet || travelSpot || phone || mapOpen || overlayOpen || loading || fatal || reportTarget || warnings.length || holdUp || robTarget);

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
      if (robTarget) setRobTarget(null);
      else if (travelSpot) setTravelSpot(null);
      else if (plotSheet) setPlotSheet(null);
      else if (clubBar) setClubBar(null);
      else if (clubTable) setClubTable(null);
      else if (sheet) setSheet(null);
      else if (mapOpen) setMapOpen(false);
      else if (phone) setPhone(null);
      else if (helpOpen) setHelpOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, plotSheet, clubBar, clubTable, mapOpen, phone, helpOpen, robTarget, travelSpot]);

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
    if (interaction.kind === "travel") {
      setTravelSpot({ interior: interaction.interior, spot: interaction.spot });
      void refresh();
      return;
    }
    if (interaction.kind === "holdUp") {
      setRobTarget({ sessionId: interaction.sessionId, name: interaction.name });
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
    } else if (interaction.spot === "bar" && propertyId) {
      const place = propertyPlace(propertyId);
      if (place?.kind === "club") setClubBar(place);
    } else if (interaction.spot === "dance") {
      engine?.playEmote("dance");
    } else if (interaction.spot.startsWith("table-")) {
      setClubTable(Number(interaction.spot.slice(6)));
    }
  };

  const inClub = Boolean(hud?.location === "interior" && hud.propertyId && CLUBS[hud.propertyId]);
  const clubId = inClub ? hud!.propertyId! : null;
  const showClubTables = useCallback((tables: ClubTable[]) => {
    setClubTables(tables);
    engine?.setClubTables(tables);
  }, [engine]);
  useEffect(() => {
    if (!clubId) {
      setClubTables([]);
      setClubTable(null);
      return;
    }
    let live = true;
    const poll = () => api.clubTables(clubId).then((tables) => live && showClubTables(tables)).catch(() => undefined);
    void poll();
    const timer = setInterval(poll, 4_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [clubId, showClubTables]);

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
    <div className={`game-view ${touch ? "touch" : "pointer"}${HOST_BADGE ? " host-badge" : ""}`}>
      <div ref={canvasHostRef} className="game-canvas-host" />
      <div ref={overlayRef} className="world-tags" />
      {touch && engine && !blocking && !chatOpen && <TouchLook engine={engine} />}

      {loading && (
        <div className="loading-overlay" role="status">
          <div className="wordmark"><span>LL</span> LAGOS LIVING</div>
          <p>{loading.text}</p>
          <div className="progress"><i style={{ width: `${Math.round(loading.progress * 100)}%` }} /></div>
        </div>
      )}
      {elsewhere && (
        <div className="loading-overlay" role="alert" data-testid="open-elsewhere">
          <div className="wordmark"><span>LL</span> LAGOS LIVING</div>
          <p>Lagos Living is open in another tab, so this one paused to save your device's graphics memory.</p>
          <button className="primary" onClick={playHere}>Play here instead</button>
        </div>
      )}
      {graphicsPaused && !fatal && (
        <div className="loading-overlay" role="status" data-testid="graphics-paused">
          <div className="wordmark"><span>LL</span> LAGOS LIVING</div>
          <p>Your device paused the graphics to free memory. Restoring the city…</p>
        </div>
      )}
      {fatal && (
        <div className="loading-overlay error" role="alert">
          <h2>The city could not load</h2>
          <p>{fatal}</p>
          <div className="row">
            <button className="primary" onClick={() => location.reload()}>Try again</button>
            {quality !== "low" && (
              <button onClick={() => { localStorage.setItem("lagos-quality", "low"); location.reload(); }}>Try with low graphics</button>
            )}
          </div>
        </div>
      )}

      {hud && engine && engine.data && (
        <>
          <section className="hud-location" aria-live="polite" data-testid="current-location">
            <p className="eyebrow">{hud.location === "bus" ? `ABOARD ${hud.bus?.routeNumber ?? ""} DANFO` : hud.location === "interior" ? "INDOORS" : hud.vehicle ? "DRIVING ON" : "YOU ARE ON"}</p>
            <h2 className={hud.streetNamed || hud.location !== "street" ? "" : "unnamed"}>{hud.street}</h2>
            <p>{hud.district}</p>
            {ride && (ride.status === "approaching" || ride.status === "waiting" || ride.status === "riding") && (
              <button className="ride-line" data-testid="ride-line" onClick={() => setPhone("ride")}>
                🚕 {ride.status === "approaching" ? `${ride.driverName} arriving · ${ride.plate}` : ride.status === "waiting" ? `${ride.driverName} is waiting · ${ride.plate}` : `Riding with ${ride.driverName}`}
              </button>
            )}
            {tows.filter((tow) => tow.stage !== "delivered").slice(0, 1).map((tow) => (
              <button key={tow.id} className="ride-line" data-testid="tow-line" onClick={() => setPhone("vehicles")}>
                🛻 {tow.stage === "loading" ? "Loading your car" : TOW_STAGE_LABEL[tow.stage]} · {tow.plate}
                {tow.stageEndsAt && tow.stageEndsAt > now ? ` · ${Math.ceil((tow.stageEndsAt - now) / 1000)}s` : ""}
              </button>
            ))}
            {tripHint(trip, hud.location) && <p className="nav-line" data-testid="trip-hint">✈ {tripHint(trip, hud.location)}</p>}
            <NavLine engine={engine} onEnd={rideTarget ? null : endRoute} />
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

          {objective && !guideHidden && sheet?.kind !== "dealership" && !(hud.location === "interior" && (trip?.flight || trip?.excursion)) && (
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
              {guideOpen && objective.target && !objectiveRoute && !manualTarget && <button className="secondary small-button" onClick={() => setQuietObjective(null)}>Show route</button>}
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

          {trip?.flight && trip.stage === "boarded" && hud.location === "interior" && <FlightPanel engine={engine} trip={trip} now={now} />}
          {trip?.excursion && hud.location === "interior" && <ExcursionPanel engine={engine} trip={trip} now={now} />}

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

          {hud.passenger && (
            <section className="speedometer passenger-badge" aria-label="Riding as a passenger">
              <div className="speed-meta">
                <p><b>Passenger</b> · {hud.passenger.owner}'s {hud.passenger.model}</p>
                <p className="muted small">{touch ? "Tap ✋ to step out when it stops" : `Press ${keyLabel(bindings.interact)} to step out when it stops`}</p>
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
                  {hud.vehicle.hire
                    ? `Hire · ${hud.vehicle.hire.minutes} min · ₦${hud.vehicle.hire.cost.toLocaleString("en-NG")} so far${hud.vehicle.hire.dockName ? ` · dock here: ${hud.vehicle.hire.dockName}` : ""}`
                    : hud.vehicle.testDriveLeft !== null
                    ? `Test drive · ${Math.floor(hud.vehicle.testDriveLeft / 60)}:${String(hud.vehicle.testDriveLeft % 60).padStart(2, "0")} left · stay near Lekki Motors`
                    : `Condition ${hud.vehicle.condition}%${hud.vehicle.limp ? ` · LIMP MODE (max ${hud.vehicle.topKmh} km/h)` : ""}`}
                </p>
                <p className="muted small">
                  <kbd>{keyLabel(bindings.forward)}</kbd>/<kbd>{keyLabel(bindings.back)}</kbd> drive · <kbd>{keyLabel(bindings.left)}</kbd>/<kbd>{keyLabel(bindings.right)}</kbd> steer · <kbd>{keyLabel(bindings.jump)}</kbd> handbrake · <kbd>{keyLabel(bindings.stop)}</kbd> horn · <kbd>{keyLabel(bindings.lights)}</kbd> lights · <kbd>{keyLabel(bindings.camera)}</kbd> camera
                </p>
              </div>
            </section>
          )}

          {hud.vehicleCamera && (
            <button className="camera-switch" data-testid="camera-switch" onClick={() => engine.cycleCamera()} aria-label={`Camera: ${VEHICLE_VIEW_LABEL[hud.vehicleCamera]}. Switch view`}>
              🎥 <span>{hud.vehicleCamera === "far" ? "Far" : "Chase"}</span>
            </button>
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
            <button onClick={() => setPhone("places")} aria-label="Places">📍<span> Places</span></button>
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
            <li>In your car: <kbd>{keyLabel(bindings.forward)}</kbd>/<kbd>{keyLabel(bindings.back)}</kbd> accelerate/brake, <kbd>{keyLabel(bindings.jump)}</kbd> handbrake, <kbd>{keyLabel(bindings.stop)}</kbd> horn, <kbd>{keyLabel(bindings.lights)}</kbd> lights, <kbd>{keyLabel(bindings.interact)}</kbd> step out</li>
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
          onTestDrive={(modelId, colour) => { setSheet(null); engine?.testDrive(modelId, colour); }}
          onPreview={previewVehicle}
        />
      )}
      {sheet?.kind === "mechanic" && (
        <MechanicSheet place={sheet} economy={economy} vehicles={vehicles} onClose={() => setSheet(null)} onRefresh={refresh} onToast={toast} />
      )}
      {sheet && COMMUNITY_KINDS.has(sheet.kind) && (
        <CommunitySheet place={sheet} economy={economy} onClose={() => setSheet(null)} onRefresh={refresh} onToast={toast} />
      )}
      {sheet?.kind === "police" && (
        <PoliceStationSheet place={sheet} economy={economy} onClose={() => setSheet(null)} onRefresh={refresh} onToast={toast} onJustice={() => setPhone("justice")} />
      )}
      {sheet?.kind === "security" && (
        <SecuritySheet place={sheet} economy={economy} onClose={() => setSheet(null)} onRefresh={refresh} onToast={toast} />
      )}
      {agbero && engine && !travelPrompts[0] && <AgberoPrompt encounter={agbero} onAnswer={(choice) => engine.answerAgbero(agbero.id, choice)} />}
      {travelPrompts[0] && engine && (
        <TravelPromptCard
          key={travelPrompts[0].requestId}
          prompt={travelPrompts[0]}
          onAnswer={(accept) => {
            const prompt = travelPrompts[0]!;
            engine.answerTravel(prompt.requestId, accept);
            setTravelPrompts((list) => list.filter((entry) => entry.requestId !== prompt.requestId));
          }}
        />
      )}
      {checkpoint && engine && (
        <CheckpointPrompt
          stop={checkpoint}
          onAnswer={(answer) => {
            engine.answerCheckpoint(checkpoint.checkpointId, answer);
            if (answer === "flee") toast({ tone: "info", text: "You put your foot down. Get clear of the checkpoint!" });
            setCheckpoint(null);
          }}
        />
      )}
      {holdUp && engine && (
        <HoldUpPrompt
          holdUp={holdUp}
          onAnswer={(answer) => {
            engine.answerHoldUp(holdUp.robberyId, answer);
            setHoldUp(null);
          }}
        />
      )}
      {robTarget && engine && (
        <div className="sheet-backdrop" onClick={() => setRobTarget(null)}>
          <section className="sheet" role="dialog" aria-label="Hold-up" data-testid="rob-confirm" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p className="eyebrow">CRIME</p>
                <h2>Rob {robTarget.name} at gunpoint?</h2>
              </div>
              <button className="icon-button" onClick={() => setRobTarget(null)} aria-label="Close">✕</button>
            </header>
            <p>
              You'd demand {Math.round(ROBBERY.share * 100)}% of their cash (at most {naira(ROBBERY.cap)}). They can run. The city records every hold-up:
              near a police station or checkpoint officers charge you on the spot, and if they report you within a day you pay it back plus a{" "}
              {naira(OFFENCES.armed_robbery.fine)} fine.
            </p>
            <div className="row">
              <button className="danger" data-testid="rob-go" onClick={() => { engine.holdUp(robTarget.sessionId); setRobTarget(null); }}>Pull the gun</button>
              <button className="secondary" onClick={() => setRobTarget(null)}>Walk away</button>
            </div>
          </section>
        </div>
      )}
      {sheet?.kind === "club" && (
        <ClubDoorSheet place={sheet} economy={economy} onClose={() => setSheet(null)} onRefresh={refresh} onToast={toast} onEnter={() => engine?.enterProperty(sheet.id, "enter")} />
      )}
      {engine && hud?.location === "interior" && hud.propertyId && CLUBS[hud.propertyId] && (
        <ClubRadio clubId={hud.propertyId} volume={settings.masterVolume} onPlaying={(playing) => engine.setClubBeat(!playing)} />
      )}
      {clubTable !== null && inClub && hud?.propertyId && (
        <ClubTableSheet
          place={propertyPlace(hud.propertyId)!}
          no={clubTable}
          tables={clubTables}
          economy={economy}
          onClose={() => setClubTable(null)}
          onRefresh={refresh}
          onToast={toast}
          onTables={showClubTables}
          onSit={() => engine?.playEmote("dance")}
        />
      )}
      {clubBar && hud?.propertyId === clubBar.id && (
        <ClubBarSheet place={clubBar} economy={economy} onClose={() => setClubBar(null)} onRefresh={refresh} onToast={toast} onServed={(name) => engine?.deliverOrder(name, true)} />
      )}
      {sheet && engine && TRAVEL_SHEET_KINDS.has(sheet.kind) && (
        <TravelPlaceSheet
          place={sheet}
          engine={engine}
          economy={economy}
          onClose={() => setSheet(null)}
          onRefresh={refresh}
          onToast={toast}
          onNavigate={(next) => setManualTarget(next)}
          onOpenApp={(app) => { setSheet(null); setPhone(app); }}
        />
      )}
      {travelSpot && engine && hud?.location === "interior" && (
        <TravelSpotSheet
          interior={travelSpot.interior}
          spot={travelSpot.spot}
          engine={engine}
          trip={trip}
          economy={economy}
          onClose={() => setTravelSpot(null)}
          onRefresh={refresh}
          onToast={toast}
          onNavigate={(next) => setManualTarget(next)}
        />
      )}
      {sheet && !["dealership", "mechanic", "club", "police", "security"].includes(sheet.kind) && !COMMUNITY_KINDS.has(sheet.kind) && !TRAVEL_SHEET_KINDS.has(sheet.kind) && (
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
          engine={engine}
          ride={ride}
          tows={tows}
        />
      )}

      {mapOpen && engine?.data && (
        <FullMap engine={engine} data={engine.data} markers={markers} onNavigate={(next) => setManualTarget(next)} onClose={() => setMapOpen(false)} />
      )}

      {touch && engine && !blocking && !chatOpen && (hud?.vehicle
        ? <DriveControls engine={engine} lights={hud.vehicle.lights} canExit={hud.vehicle.kmh < 7} bicycle={hud.vehicle.bicycle} />
        : <TouchControls engine={engine} />)}

      {welcomeOpen && !loading && (
        <Welcome playerName={playerName} economy={economy} properties={properties} touch={touch} bindings={bindings} onChoose={chooseHousing} />
      )}
    </div>
  );
}

/** Keeps a small JPEG of each travel photo on this device; the server keeps the record. */
async function savePhoto(photo: { spot: string; companions: string[]; image: string | null }) {
  if (!photo.image) return;
  try {
    const source = new Image();
    source.src = photo.image;
    await source.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = Math.round((360 * source.height) / Math.max(1, source.width));
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.7);
    const next = [{ at: Date.now(), spot: photo.spot, companions: photo.companions, image }, ...loadLocalPhotos()].slice(0, 8);
    localStorage.setItem(LOCAL_PHOTOS_KEY, JSON.stringify(next));
  } catch {
    // Storage full or the frame could not be read; the server still has the photo record.
  }
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

const metresLabel = (metres: number) => (metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(metres / 10) * 10)} m`);

/** Next turn for the current destination, re-read on every HUD refresh. */
function NavLine({ engine, onEnd }: { engine: GameEngine; onEnd: (() => void) | null }) {
  const nav = engine.navigation();
  if (!nav) return null;
  const end = onEnd && <button className="nav-end" onClick={onEnd} aria-label="End route">End</button>;
  if (!nav.reachable) {
    return <p className="nav-line warn" data-testid="nav-line">No road reaches {nav.label}. Head there on foot using the map.{end}</p>;
  }
  const guidance = nav.guidance;
  if (!guidance) return null;
  const tail = nav.gap > 40 ? ` · the road ends ${metresLabel(nav.gap)} short, walk the rest` : "";
  if (nav.rerouting) return <p className="nav-line" data-testid="nav-line"><b>⟳</b> Rerouting to {nav.label}…{end}</p>;
  if (guidance.turn === "arrive" && guidance.remaining < 40) return <p className="nav-line" data-testid="nav-line"><b>◎</b> {nav.label} is just ahead{tail}{end}</p>;
  return (
    <p className="nav-line" data-testid="nav-line">
      <b>{turnArrow[guidance.turn]}</b> {metresLabel(guidance.distance)} · {describeTurn(guidance)}
      <small> · {metresLabel(guidance.remaining)} to {nav.label}{tail}</small>
      {end}
    </p>
  );
}

type Pedals = { throttle: number; brake: number; steer: number };

/** Steering pad, pedals and buttons. Each control owns one finger, so steering and pedals work together. */
function DriveControls({ engine, lights, canExit, bicycle }: { engine: GameEngine; lights: boolean; canExit: boolean; bicycle: boolean }) {
  const pedals = useRef<Pedals>({ throttle: 0, brake: 0, steer: 0 });
  const fingers = useRef<{ steer: number | null; gas: number | null; brake: number | null }>({ steer: null, gas: null, brake: null });
  const [shown, setShown] = useState<Pedals>({ throttle: 0, brake: 0, steer: 0 });
  const update = (next: Partial<Pedals>) => {
    pedals.current = { ...pedals.current, ...next };
    setShown(pedals.current);
    engine.setTouchDrive(pedals.current);
  };
  useEffect(() => {
    const reset = () => {
      fingers.current = { steer: null, gas: null, brake: null };
      pedals.current = { throttle: 0, brake: 0, steer: 0 };
      setShown(pedals.current);
      engine.setTouchDrive(null);
    };
    const hidden = () => document.hidden && reset();
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", hidden);
      engine.setTouchDrive(null);
    };
  }, [engine]);
  const steerTo = (event: React.PointerEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const offset = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    update({ steer: Math.max(-1, Math.min(1, offset * 1.25)) });
  };
  const pedal = (key: "gas" | "brake") => ({
    onPointerDown: (event: React.PointerEvent) => {
      if (fingers.current[key] !== null) return;
      fingers.current[key] = event.pointerId;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      update(key === "gas" ? { throttle: 1 } : { brake: 1 });
    },
    onPointerUp: (event: React.PointerEvent) => lift(key, event),
    onPointerCancel: (event: React.PointerEvent) => lift(key, event),
    onLostPointerCapture: (event: React.PointerEvent) => lift(key, event),
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  });
  const lift = (key: "gas" | "brake" | "steer", event: React.PointerEvent) => {
    if (fingers.current[key] !== event.pointerId) return;
    fingers.current[key] = null;
    update(key === "gas" ? { throttle: 0 } : key === "brake" ? { brake: 0 } : { steer: 0 });
  };
  return (
    <div className="drive-controls" data-testid="drive-controls">
      <div
        className="steer-pad"
        aria-label="Steering: drag left or right"
        onPointerDown={(event) => {
          if (fingers.current.steer !== null) return;
          fingers.current.steer = event.pointerId;
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          steerTo(event);
        }}
        onPointerMove={(event) => fingers.current.steer === event.pointerId && steerTo(event)}
        onPointerUp={(event) => lift("steer", event)}
        onPointerCancel={(event) => lift("steer", event)}
        onLostPointerCapture={(event) => lift("steer", event)}
        onContextMenu={(event) => event.preventDefault()}
      >
        <span className="steer-arrow left">◀</span>
        <i style={{ transform: `translate(calc(-50% + ${shown.steer * 42}%), -50%) rotate(${shown.steer * 70}deg)` }} />
        <span className="steer-arrow right">▶</span>
      </div>
      <div className="drive-buttons">
        <button onClick={() => engine.honk()} aria-label={bicycle ? "Bell" : "Horn"}>{bicycle ? "Bell" : "Horn"}</button>
        {!bicycle && <button className={lights ? "active" : ""} aria-pressed={lights} onClick={() => engine.toggleLights()}>Lights</button>}
        <button disabled={!canExit} onClick={() => engine.triggerInteract()}>{canExit ? (bicycle ? "Get off" : "Exit") : "Slow down"}</button>
      </div>
      <div className="pedals">
        <button className={`pedal brake ${shown.brake ? "active" : ""}`} aria-label="Brake, hold to reverse" {...pedal("brake")}>
          Brake<small>hold to reverse</small>
        </button>
        <button className={`pedal gas ${shown.throttle ? "active" : ""}`} aria-label={bicycle ? "Pedal" : "Accelerate"} {...pedal("gas")}>
          {bicycle ? "Pedal" : "Go"}
        </button>
      </div>
    </div>
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
