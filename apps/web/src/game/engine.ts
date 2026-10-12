import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Helpers/sceneHelpers";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import "@babylonjs/core/Culling/ray";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { HDRCubeTexture } from "@babylonjs/core/Materials/Textures/hdrCubeTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import {
  defaultSettings,
  effectiveTopSpeed,
  dialSpeed,
  getPlace,
  getVehicleModel,
  TEST_DRIVE,
  INTERACTION_RANGE,
  VEHICLE_RULES,
  type WorldVehicle,
  blockedByWater,
  builtHomeId,
  houseDesign,
  GIG_RANGE,
  houseDoor,
  PLOT_TERMS,
  PLOTS,
  syncPlotFootprints,
  defaultAppearance,
  districtAt,
  insideBuilding,
  HOME_LAYOUTS,
  homeLayout,
  type HomeTier,
  INTERIOR_ORIGIN,
  MOVEMENT,
  PLACES,
  propertyTitle,
  bottleById,
  CLUBS,
  CLUB_LAYOUT,
  CLUB_TABLES,
  type Club,
  type ClubTable,
  resolveBuildingCollision,
  getRoute,
  STOPS,
  stopById,
  stopLabel,
  withinWorld,
  type BusState,
  type CharacterAppearance,
  type ChatMessage,
  type ExerciseId,
  type Look,
  type MotionState,
  type NetworkPlayer,
  type Notice,
  type Place,
  type PlayerSettings,
  type SelfState,
  type Vec2,
  RIDE,
  rideFare,
  TOW,
  walkable,
  BIKE_RENTAL,
  BIKE_STATIONS,
  nearestBikeStation,
  rentalUsage,
  type RideState,
  type TowDestination,
  type TowState,
  ROBBERY,
  emptyTrip,
  EXCURSION_SEATS,
  flightPhase,
  legRoute,
  placeById,
  placeDistance,
  seatPoint,
  TRAVEL,
  TRAVEL_PLACES,
  travelInteriorOf,
  type ActivityId,
  type FlightPhase,
  type TravelInterior,
  type TripState,
  type FastTravelState,
  type AgberoChoice,
  type AgberoEncounter,
  type Favourite,
  type TravelPrompt,
  type FoodParcel,
  type GuardsChase,
  propertyPlace,
  regionOf,
} from "@lagos-living/shared";
import { buildTravelInterior, TRAVEL_SEAT_Y, type TravelView } from "./travel-interiors";
import { COMPOUND_PLACES, compoundCars } from "./compounds";
import { EntranceMarkers, type EntranceCandidate } from "./entrance-markers";
import { TourGuide, tourStops } from "./tour-guide";
import { gymStations, type GymStation } from "./gym-stations";
import { RepairSite } from "./repair-site";
import { PropLibrary } from "./props";
import { HomeStaffView, type StaffPost } from "./home-staff-view";
import { PartyLights } from "./party-lights";
import { Escort, type EscortLeader } from "./escort";
import { StreetCrews } from "./street-crews";
import { CarSpotters, type SpottedCar } from "./car-spotters";
import { apiUrl, authHeaders } from "../auth-client";
import type { PlotState } from "../api";
import { buildProgress } from "./build-progress";
import { PlotsView } from "./plots";
import { MultiplayerConnection, type MultiplayerStatus, type PoliceEvent, type RideAsk } from "../multiplayer";
import { AdaptiveQuality, FULL_FOG_DENSITY, FULL_VIEW_DISTANCE, MAX_AUTO_SCALING, qualityStep } from "./adaptive-quality";
import { CityAudio } from "./audio";
import { appearanceFor, Avatar, AvatarFactory, dubaiDriverLook, taxiDriverLook } from "./avatar";
import { CLUB_BARTENDER, clubWaitress, deskStaffFor, seatsFor, serviceOrigin, ServiceStaff, staffLook, type StaffProp } from "./service-staff";
import { buildMenuItem, buildServingTray } from "./drinks";
import { addTaxiLivery } from "./taxi-livery";
import { CarController } from "./car-controller";
import { VehicleFactory, type VehicleView } from "./vehicles";
import { guide, type Guidance, type RoutePlan } from "./navigation";
import { RoutePilot } from "./route-pilot";
import { TowRig } from "./tow-rig";
import { BAY_SIZE, buildServiceBay, serviceBay } from "./service-bay";
import { BikeStationsView } from "./bike-stations";
import { defaultBindings, InputState, LocomotionController, MAX_FRAME_DT, SUBSTEP_DT, type Bindings, type MoveMode } from "./controller";
import { DanfoFactory, type DanfoView } from "./danfo";
import { MeshBuilderBatch } from "./geometry";
import { buildMealTray, buildTrolley } from "./flight-scenes";
import { Couriers } from "./couriers";
import { ListingBoards, type BoardLabel } from "./listing-boards";
import { buildInterior, interiorModels, type HomeRest, type InteriorKind, type InteriorSpot, type InteriorView, type Placement } from "./interior";
import { createMaterials, type Materials, type Quality } from "./materials";
import { SignAtlas } from "./sign-atlas";
import { RoadNavigator, StreetTracker, type WorldData, type WorldTile } from "./street-index";
import { AmbientLife, trafficModels } from "./traffic";
import { buildWorld, type BuiltWorld } from "./world-builder";

export type Prompt = { key: string; label: string; detail?: string | undefined; disabled?: boolean };

export type VehicleCameraView = "chase" | "far";
const VEHICLE_VIEWS: VehicleCameraView[] = ["chase", "far"];
export const VEHICLE_VIEW_LABEL: Record<VehicleCameraView, string> = { chase: "Chase camera", far: "Far chase camera" };
const RECENTRE_IDLE_MS = 2_500;

export type HudState = {
  network: MultiplayerStatus["state"];
  networkReason?: string | undefined;
  online: number;
  street: string;
  streetNamed: boolean;
  district: string;
  location: "street" | "interior" | "bus";
  interiorTitle: string | null;
  propertyId: string | null;
  previewOnly: boolean;
  prompt: Prompt | null;
  secondaryPrompt: Prompt | null;
  bus: { id: string; routeNumber: string; routeName: string; seat: number | null; nextStop: string; atStop: string | null; stopRequested: boolean; occupied: number; capacity: number } | null;
  vehicleCamera: VehicleCameraView | null;
  vehicle: { id: string; name: string; plate: string; kmh: number; topKmh: number; condition: number; limp: boolean; reversing: boolean; bicycle: boolean; lights: boolean; seats: number; testDriveLeft: number | null; hire: { minutes: number; cost: number; dockName: string | null } | null } | null;
  passenger: { owner: string; model: string } | null;
  speed: number;
  mode: MoveMode;
  motion: MotionState;
  fps: number;
  frameMs: number;
  /** Automatic quality reduction level; 0 means the chosen preset is used as is. */
  qualityStep: number;
  x: number;
  z: number;
  yaw: number;
  cameraYaw: number;
  waypoint: { label: string; distance: number } | null;
};

export type Interaction =
  | { kind: "place"; place: Place }
  | { kind: "delivery" }
  | { kind: "gig" }
  | { kind: "repair" }
  | { kind: "interior"; spot: InteriorSpot["id"] }
  | { kind: "travel"; interior: TravelInterior; spot: string }
  | { kind: "plot"; plotId: string }
  | { kind: "holdUp"; sessionId: string; name: string }
  | { kind: "parcel"; parcelId: string };

export type EngineCallbacks = {
  hud: (state: HudState) => void;
  notice: (notice: Notice) => void;
  /** Pays for spraying money at the car spotters; resolves false when refused. */
  spray: (amount: number) => Promise<boolean>;
  /** Speech is shown in quotes; sound captions describe meaningful non-speech audio. */
  subtitle: (text: string, kind?: "speech" | "sound") => void;
  interact: (interaction: Interaction) => void;
  self: (self: SelfState) => void;
  saved: (at: number) => void;
  loading: (text: string, progress: number) => void;
  ready: () => void;
  toggle: (panel: "phone" | "map" | "help") => void;
  chat: (message: ChatMessage, own: boolean) => void;
  suspended: (info: { reason: string; until: string | null }) => void;
  plotsChanged: () => void;
  ride: (ride: RideState | null) => void;
  tows: (tows: TowState[]) => void;
  /** WebGL context lost/restored by the browser, or frames failing repeatedly. */
  graphics: (event: "lost" | "restored" | "failed") => void;
  police: (event: PoliceEvent) => void;
  trip: (trip: TripState) => void;
  photo: (photo: { spot: string; companions: string[]; image: string | null }) => void;
  /** Someone asks this player to travel with them, or to join them; nothing happens unless they accept. */
  travelPrompt: (prompt: TravelPrompt) => void;
  /** Someone at this player's car or booked cab asks to come along; they only get in if allowed. */
  rideAsk: (ask: RideAsk) => void;
  /** A roadside tout asks this driver for change; null when it is over. */
  agbero: (encounter: AgberoEncounter | null) => void;
  /** The player reached the waypoint; the route has already been cleared. */
  arrived: (label: string) => void;
  /** What the player has in hand (a drink or a plate from the club bar) and how many sips or bites are left; null when empty. */
  holding: (item: { name: string; left: number; food: boolean } | null) => void;
  /** The player sat down on a home sofa, chair or bed (`kind`), or got up again (null). */
  resting?: (kind: HomeRest | null) => void;
};

type Remote = {
  avatar: Avatar | null;
  tag: HTMLDivElement;
  samples: Array<{ t: number; x: number; z: number; yaw: number; motion: MotionState; busId: string | null; vehicleId: string | null; vehicleSeat: number | null }>;
  speed: number;
  lastSeen: number;
  name: string;
  guards: number;
};

/** Escorts of other residents are drawn only this close. */
const ESCORT_VISIBLE_RANGE = 150;
/** An owner's gate opens when they come this close, or their guard opens it from this far. */
const GATE_OPEN_RANGE = 9;
const GATE_GUARD_RANGE = 24;

/** Danfos further than this are hidden; other districts' loops are kilometres away. */
const DANFO_VISIBLE_RANGE = 700;

const PLACE_ACTIONS: Record<Place["kind"], string> = {
  starter_home: "Enter",
  rental: "View rental",
  sale: "View house for sale",
  job: "Delivery jobs",
  food: "Buy food",
  shop: "Shop",
  furniture: "Furniture",
  delivery: "Deliver parcel",
  dealership: "Browse cars",
  mechanic: "Mechanic",
  library: "Read",
  worship: "Visit",
  community: "Community hall",
  park: "Relax",
  club: "Enter club",
  police: "Police station",
  security: "Hire security",
  airport: "Enter the terminal",
  consulate: "Enter the consular office",
  hotel: "Hotel reception",
  restaurant: "Eat",
  cafe: "Café",
  boutique: "Shop clothes",
  souvenir: "Buy souvenirs",
  lounge: "Rooftop lounge",
  beach: "Beach",
  marina: "Dhow cruises",
  photo: "Take a photo",
  desert: "Desert camp",
  car_rental: "Hire a car",
  tourism: "Things to do in Dubai",
  gym: "Gym",
  estate: "Estate agent",
};

/** Lines the crew say on a 60-second flight, keyed by phase. */
const CABIN_ANNOUNCEMENTS: Partial<Record<FlightPhase, string>> = {
  takeoff: "Cabin crew, seats for take-off. Please keep your seatbelt fastened.",
  cruise: "We've reached cruising altitude. Our crew will now come through the cabin with food and drinks.",
  descent: "We have started our descent. Please return your seat to the upright position.",
};

const TRAVEL_DISTRICT: Record<TravelInterior, string> = {
  consulate: "Victoria Island · Lagos",
  "airport-los": "Lagos",
  "airport-dxb": "Dubai",
  cabin: "In the air",
  hotel: "Dubai Marina · Dubai",
  rooftop: "Dubai Marina · Dubai",
  dhow: "Dubai Marina · Dubai",
  safari: "Dubai desert",
  pool: "Dubai Marina · Dubai",
};

/** Full avatars drawn at once for other residents, per graphics preset. */
const AVATAR_LIMIT: Record<Quality, number> = { low: 10, medium: 18, high: 30 };

/** White arrowheads every `spacing` metres along a route ribbon of half-width `half`, pointing toward the destination. */
function routeChevrons(batch: MeshBuilderBatch, points: Vec2[], half: number, spacing: number) {
  const up: [number, number, number] = [0, 1, 0];
  const white: [number, number, number] = [1, 1, 1];
  let next = spacing * 0.6;
  let along = 0;
  for (let index = 1; index < points.length; index += 1) {
    const [ax, az] = points[index - 1]!;
    const [bx, bz] = points[index]!;
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 0.01) continue;
    const fx = (bx - ax) / length;
    const fz = (bz - az) / length;
    while (next <= along + length) {
      const t = next - along;
      const cx = ax + fx * t;
      const cz = az + fz * t;
      const tip: [number, number, number] = [cx + fx * half * 0.9, 0.24, cz + fz * half * 0.9];
      const back = half * 0.8;
      batch.triangle(tip, [cx - fx * back + fz * half * 0.85, 0.24, cz - fz * back - fx * half * 0.85], [cx - fx * back * 0.35, 0.24, cz - fz * back * 0.35], up, [[0, 0], [1, 0], [0, 1]], white);
      batch.triangle(tip, [cx - fx * back * 0.35, 0.24, cz - fz * back * 0.35], [cx - fx * back - fz * half * 0.85, 0.24, cz - fz * back + fx * half * 0.85], up, [[0, 0], [1, 0], [0, 1]], white);
      next += spacing;
    }
    along += length;
  }
}

export type CabinAudio = { hum: boolean; announcements: boolean };
function loadCabinAudio(): CabinAudio {
  try {
    return { hum: true, announcements: true, ...(JSON.parse(localStorage.getItem("lagos-cabin-audio") ?? "{}") as Partial<CabinAudio>) };
  } catch {
    return { hum: true, announcements: true };
  }
}

export class EngineDisposedError extends Error {
  constructor() {
    super("Engine disposed during start");
  }
}

export class GameEngine {
  private engine!: Engine;
  private scene!: Scene;
  private camera!: TargetCamera;
  private sun!: DirectionalLight;
  private shadows: ShadowGenerator | null = null;
  private materials!: Materials;
  private atlas!: SignAtlas;
  data!: WorldData;
  private world!: BuiltWorld;
  private avatars: AvatarFactory | null = null;
  private props: PropLibrary | null = null;
  private readonly streetProps: Array<{ dispose(): void }> = [];
  private staff!: ServiceStaff;
  private danfos: DanfoFactory | null = null;
  private player: Avatar | null = null;
  private playerFallback: Mesh | null = null;
  private parcel: Mesh | null = null;
  private life: AmbientLife | null = null;
  private input!: InputState;
  private controller: LocomotionController;
  private net: MultiplayerConnection;
  private audio: CityAudio;
  private tracker!: StreetTracker;
  navigator!: RoadNavigator;
  private remotes = new Map<string, Remote>();
  /** Hired escorts by session id; "self" is the player's own. */
  private escorts = new Map<string, Escort>();
  private guardChases: GuardsChase[] = [];
  private ownGuards = 0;
  private crews: StreetCrews | null = null;
  private entrances: EntranceMarkers | null = null;
  /** The desk the HUD wants the player to walk to next inside a terminal or other travel interior. */
  private indoorGuide: { spot: string; label: string } | null = null;
  private tour: TourGuide | null = null;
  /** A gym set in progress: the player is held at the station doing the exercise until it ends or they move off. */
  private workout: { station: GymStation; time: number } | null = null;
  private repairSite: { placeId: string; site: RepairSite } | null = null;
  private repairing: { until: number; time: number } | null = null;
  private guideLine: Mesh | null = null;
  private homeStaff: HomeStaffView | null = null;
  private couriers: Couriers | null = null;
  private listingBoards: ListingBoards | null = null;
  private listingLabels = new Map<string, BoardLabel>();
  private boardsAt = 0;
  private heldParcel: { id: string; node: TransformNode } | null = null;
  private staffPosts: StaffPost[] = [];
  private staffPostsAt = 0;
  private partyLights: PartyLights | null = null;
  private spotters: CarSpotters | null = null;
  private gatePlot: string | null = null;
  private looks = new Map<string, CharacterAppearance>();
  private builds = new Map<string, number>();
  private build = 0;
  private appearance: CharacterAppearance = defaultAppearance;
  private buses = new Map<string, DanfoView>();
  private busTags = new Map<string, HTMLDivElement>();
  private interior: InteriorView | TravelView | null = null;
  private travelView: TravelView | null = null;
  private trip: TripState = emptyTrip();
  private seatYaw = 0;
  private flightPhaseShown: FlightPhase | null = null;
  /** Outside camera during the take-off and landing shots; null otherwise. */
  private flightShot: { eye: Vector3; look: Vector3 } | null = null;
  private flightShotCaption: "takeoff" | "landing" | null = null;
  private crew: Array<{ avatar: Avatar; z: number; dir: number; served: boolean }> = [];
  private trolley: TransformNode | null = null;
  private mealTray: TransformNode | null = null;
  private cabinAudio: CabinAudio = loadCabinAudio();
  private preloadPending = 0;
  private serverOffset = 0;
  private plotsView: PlotsView | null = null;
  private plotStates: PlotState[] = [];
  private lastPlotDraw = 0;
  private self: SelfState | null = null;
  private status: MultiplayerStatus = { state: "connecting" };
  private online = 1;
  private cameraYaw = 0;
  private cameraPitch = 0.32;
  private cameraDistance = 4.6;
  private cameraTarget = new Vector3();
  private cameraPosition = new Vector3();
  private groundY = 0;
  private lastSend = 0;
  private lastSent = { x: 0, z: 0, motion: "idle" as MotionState };
  private lastHud = 0;
  private lastInteract = 0;
  private prompt: Prompt | null = null;
  private secondary: Prompt | null = null;
  private interaction: (() => void) | null = null;
  private deliveryTarget: { point: Vec2; label: string } | null = null;
  private gigTarget: { point: Vec2; title: string; place: string } | null = null;
  private waypoint: { point: Vec2; label: string } | null = null;
  /** Set when the waypoint is a building's door: the route then runs to the door itself, not just the kerb. */
  private waypointDoor: EntranceCandidate | null = null;
  private parkNoticeFor: string | null = null;
  private lastStreet: Vec2 = [0, 0];
  private beacon: Mesh | null = null;
  private routeMesh: Mesh | null = null;
  private routeMaterial: PBRMaterial | null = null;
  private lastRoute = { at: 0, x: 0, z: 0 };
  private routePlan: RoutePlan | null = null;
  private guidance: Guidance | null = null;
  private reroutedAt = 0;
  private routePoints: Vec2[] = [];
  private emote: MotionState | null = null;
  private club: Club | null = null;
  private tableBottles = new Map<number, string[]>();
  private waiters: Array<{ avatar: Avatar; path: Vec2[]; t: number; table: number; bottles: Array<{ id: string; itemId: string }>; prop: TransformNode; sparkler: boolean }> = [];
  private settings: PlayerSettings;
  private bindings: Bindings;
  private disposed = false;
  private frameDrawCalls = 0;
  private justAlighted: { busId: string; at: number } | null = null;
  private maxFrameDt = MAX_FRAME_DT;
  private frameMs = 0;
  private updateMs = 0;
  private readonly callbacks: EngineCallbacks;
  private frameTimes: number[] = [];
  private readonly adaptive = new AdaptiveQuality();
  private frameGap = 0;
  private lastUpdateAt = 0;
  private baseScaling = 1;
  /** Seated (or, on a club stool, standing up and dancing) on a fixed seat; `y` is the cushion height. */
  private sitting: { seat: Vec2; yaw: number; y: number; pose: "sit" | "dance"; stool?: boolean; rest?: HomeRest } | null = null;
  private restingAs: HomeRest | null = null;
  private heldItem: { node: TransformNode; name: string; left: number; food: boolean } | null = null;
  private autopilot: { path: Vec2[]; index: number; sprint: boolean; resolve: (ok: boolean) => void; lastProgress: number; lastPoint: Vec2; deadline: number } | null = null;
  private forcedInput: [number, number] | null = null;
  private readyFired = false;
  private vehicleFactory: VehicleFactory | null = null;
  private vehicles = new Map<string, { view: VehicleView; state: WorldVehicle; tag: HTMLDivElement; driver: Avatar | null; rig: TowRig | null }>();
  private ride: RideState | null = null;
  private bikeStock: Record<string, number> = {};
  private bikeStations: BikeStationsView | null = null;
  /** Lekki Motors' forecourt display cars (client-only, but solid). */
  private showroom: VehicleView[] = [];
  /** Cars parked in the Ikoyi compounds, created only while the player is nearby. */
  private compoundViews = new Map<string, VehicleView[]>();
  private lastCompoundCheck = 0;
  private showcaseAngle = 0;
  /** The car being browsed at the dealership, shown on the forecourt with the camera circling it. */
  private showcase: { view: VehicleView | null; modelId: string; colour: string; point: Vec2; yaw: number; request: number } | null = null;
  private rideCar: { vehicleId: string; car: CarController; pilot: RoutePilot; stopping: boolean; sentAt: number } | null = null;
  private tows = new Map<string, TowState>();
  private rideApproach: { rideId: string; view: VehicleView; driver: Avatar | null; path: Vec2[]; along: number[]; startAt: number; arrivesAt: number } | null = null;
  private car: CarController | null = null;
  private driving: { vehicleId: string; condition: number } | null = null;
  private lights = false;
  private passenger: { vehicleId: string; seat: number } | null = null;
  private pendingDrive: string | null = null;
  private lastContactAt = 0;
  private lastImpactSentAt = 0;
  private lastLookAt = 0;
  /** Vehicle camera the player picked (kept between trips). */
  private vehicleView: VehicleCameraView = localStorage.getItem("lagos-vehicle-camera") === "far" ? "far" : "chase";
  /** Unobstructed camera distance, eased back out after a wall or car pushed it in. */
  private cameraReach = 0;
  /** Police have waved the car down: it brakes to a halt until the driver complies or floors it. */
  private flaggedDown = false;
  private transfer: { el: HTMLDivElement; shownAt: number; arrivedAt: number | null; minMs: number } | null = null;
  /** When the last enter/exit/travel request was sent; repeat taps are ignored until the server answers or 3 s pass. */
  private transitionAt = 0;
  /** Bumped on every interior change so a slow furniture fetch cannot replace a newer room. */
  private interiorToken = 0;
  /** Home designer: share of the screen (from the top) showing the room from straight above, or null. */
  private planShare: number | null = null;
  private carPilot: {
    path: Vec2[];
    index: number;
    resolve: (ok: boolean) => void;
    deadline: number;
    stuckSince: number | null;
    recovery: { until: number; swerveUntil: number; side: number } | null;
    recoveries: number;
  } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly overlay: HTMLDivElement,
    callbacks: EngineCallbacks,
    private readonly quality: Quality,
    settings: PlayerSettings,
    bindings: Bindings,
    /** WebGL1 on the low-power GPU: a fallback for browsers whose WebGL2 context keeps failing. */
    private readonly safeGraphics = false,
  ) {
    this.callbacks = Object.fromEntries(
      Object.entries(callbacks).map(([key, fn]) => [key, (...args: unknown[]) => (this.disposed ? undefined : (fn as (...a: unknown[]) => unknown)(...args))]),
    ) as unknown as EngineCallbacks;
    this.settings = settings;
    this.bindings = bindings;
    overlay.classList.toggle("hide-names", localStorage.getItem("lagos-name-labels") === "0");
    this.controller = new LocomotionController((x, z) => this.collide(x, z));
    this.audio = new CityAudio(settings);
    this.net = new MultiplayerConnection({
      snapshot: (snapshot, own) => this.onSnapshot(snapshot, own),
      self: (self) => this.onSelf(self),
      notice: (notice) => {
        this.callbacks.notice(notice);
        if (notice.tone === "error" && this.transitionAt) {
          this.transitionAt = 0;
          if (this.transfer && this.transfer.minMs < 900 && !this.transfer.arrivedAt) this.transfer.arrivedAt = performance.now() - 6_000;
        }
        if (notice.announcement) {
          if (this.settings.subtitles) this.callbacks.subtitle(notice.announcement);
          this.audio.announce(notice.announcement);
        }
      },
      correction: ({ x, z }) => {
        this.controller.teleport(x, z);
        for (const car of [this.car, this.rideCar?.car]) {
          if (!car) continue;
          car.x = x;
          car.z = z;
          car.speed = 0;
        }
      },
      saved: (at) => this.callbacks.saved(at),
      vehicleStatus: ({ vehicleId, condition, damage }) => {
        if (this.driving?.vehicleId !== vehicleId) return;
        this.driving.condition = condition;
        if (damage && damage >= 4 && condition > 0) this.callbacks.notice({ tone: "info", text: `Bump! −${damage}% condition (${condition}% left).` });
      },
      horn: ({ x, z }) => this.hornAt(x, z),
      status: (status) => {
        this.status = status;
      },
      chat: (message) => {
        const own = message.sessionId === this.net.sessionId;
        if (!own) this.showBubble(message);
        this.callbacks.chat(message, own);
      },
      suspended: (info) => this.callbacks.suspended(info),
      looks: (looks) => this.onLooks(looks),
      plots: () => this.callbacks.plotsChanged(),
      interior: () => void this.refreshInterior(),
      ride: (ride) => this.onRide(ride),
      bikeStock: (stock) => {
        this.bikeStock = stock;
      },
      tows: (tows, replace) => {
        if (replace) this.tows.clear();
        for (const tow of tows) this.tows.set(tow.id, tow);
        for (const [id, tow] of this.tows) if (tow.stage === "cancelled" || (tow.stage === "delivered" && !tows.some((entry) => entry.id === id))) this.tows.delete(id);
        this.callbacks.tows([...this.tows.values(), ...tows.filter((tow) => tow.stage === "cancelled")]);
      },
      police: (event) => {
        if (event.type === "checkpoint") {
          this.crews?.setFlagged(event.stop.checkpointId);
          this.flaggedDown = true;
        }
        if (event.type === "checkpointEnd") {
          this.crews?.setFlagged(null);
          this.flaggedDown = false;
        }
        if (event.type === "guardsChase") this.guardChases.push(event.chase);
        this.callbacks.police(event);
      },
      trip: (trip) => this.onTrip(trip),
      goState: (state) => this.goListener?.(state),
      travelPrompt: (prompt) => this.callbacks.travelPrompt(prompt),
      rideAsk: (ask) => this.callbacks.rideAsk(ask),
      agbero: (encounter) => {
        this.showTout(encounter);
        this.callbacks.agbero(encounter);
      },
      react: ({ sessionId, emoji }) => {
        if (sessionId === this.net.sessionId) return;
        const remote = this.remotes.get(sessionId);
        if (!remote) return;
        remote.tag.querySelector(".chat-bubble")?.remove();
        const bubble = document.createElement("span");
        bubble.className = "chat-bubble reaction";
        bubble.textContent = emoji;
        remote.tag.prepend(bubble);
        setTimeout(() => bubble.remove(), 3_000);
      },
      photo: (photo) => {
        // The drawing buffer is only readable straight after a render.
        this.scene?.onAfterRenderObservable.addOnce(() => {
          let image: string | null = null;
          try {
            image = this.canvas.toDataURL("image/jpeg", 0.72);
          } catch {
            image = null;
          }
          this.callbacks.photo({ ...photo, image });
        });
      },
    });
  }

  async start() {
    const engine = new Engine(
      this.canvas,
      this.quality !== "low" && !this.safeGraphics,
      this.safeGraphics
        ? { stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power", disableWebGL2Support: true }
        : { stencil: false, preserveDrawingBuffer: false, powerPreference: "high-performance" },
      false,
    );
    // A context that is already lost cannot create textures; fail fast so the UI can retry.
    if ((engine as unknown as { _gl: WebGLRenderingContext })._gl.isContextLost()) {
      engine.dispose();
      throw new Error("WebGL context unavailable");
    }
    this.engine = engine;
    const dpr = window.devicePixelRatio || 1;
    this.baseScaling = this.quality === "low" ? 1.2 : this.quality === "medium" ? Math.max(1, dpr / 1.25) / dpr : 1 / Math.min(dpr, 1.5);
    engine.setHardwareScalingLevel(this.baseScaling);
    const scene = new Scene(engine);
    this.scene = scene;
    scene.skipPointerMovePicking = true;
    scene.clearColor = new Color4(0.74, 0.84, 0.93, 1);
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    scene.imageProcessingConfiguration.exposure = 1.05;
    scene.imageProcessingConfiguration.contrast = 1.12;
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = FULL_FOG_DENSITY;
    scene.fogColor = new Color3(0.78, 0.84, 0.88);

    this.camera = new TargetCamera("camera", new Vector3(0, 3, -5), scene);
    this.camera.fov = 0.95;
    this.camera.minZ = 0.1;
    this.camera.maxZ = FULL_VIEW_DISTANCE;
    if (this.quality === "high") {
      // Soft bloom on lamps, neon and sun glints plus a light sharpen; scene tone mapping stays in charge of colour.
      const pipeline = new DefaultRenderingPipeline("finish", false, scene, [this.camera]);
      pipeline.imageProcessingEnabled = false;
      pipeline.bloomEnabled = true;
      pipeline.bloomThreshold = 0.82;
      pipeline.bloomWeight = 0.22;
      pipeline.bloomKernel = 48;
      pipeline.bloomScale = 0.5;
      pipeline.sharpenEnabled = true;
      pipeline.sharpen.edgeAmount = 0.25;
    }

    this.callbacks.loading("Lighting the island…", 0.1);
    const hdr = new HDRCubeTexture("/assets/sky/daylight-1k.hdr", scene, 256, false, true, false, true);
    scene.environmentTexture = hdr;
    scene.environmentIntensity = 0.9;
    this.createSky(scene);

    this.sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.32).normalize(), scene);
    this.sun.intensity = 3.1;
    this.sun.diffuse = Color3.FromHexString("#fff2dc");
    const fill = new HemisphericLight("sky fill", new Vector3(0, 1, 0), scene);
    fill.intensity = 0.32;
    fill.groundColor = Color3.FromHexString("#b39a7c");
    if (this.quality !== "low") {
      this.shadows = new ShadowGenerator(this.quality === "high" ? 2048 : 1024, this.sun);
      this.shadows.usePercentageCloserFiltering = true;
      this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
      this.shadows.bias = 0.0008;
      this.shadows.normalBias = 0.02;
      this.sun.shadowFrustumSize = 90;
      this.sun.shadowMinZ = 1;
      this.sun.shadowMaxZ = 260;
      this.sun.autoUpdateExtends = false;
    }

    this.materials = createMaterials(scene, this.quality);
    this.atlas = new SignAtlas(scene, this.quality === "low" ? 0.5 : 1);
    this.staff = new ServiceStaff(scene, () => this.avatars, (text) => this.callbacks.notice({ tone: "success", text }), (x, z) => (this.interior ? 0.02 : this.world.groundHeight(x, z)));
    MeshBuilderBatch.keepCpuCopies = this.quality !== "low";
    this.callbacks.loading("Loading Lagos streets…", 0.25);
    const response = await fetch("/assets/world/lagos.world.json");
    if (!response.ok) throw new Error("World data could not be loaded");
    this.data = (await response.json()) as WorldData;
    this.assertLive();
    this.callbacks.loading("Building houses, compounds and junctions…", 0.4);
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.assertLive();
    const fetchTile = async (key: string) => {
      const tile = await fetch(`/assets/world/tiles/${key}.json`);
      if (!tile.ok) throw new Error(`Tile ${key} could not be loaded`);
      return (await tile.json()) as WorldTile;
    };
    this.world = buildWorld(scene, this.data, this.materials, this.atlas, this.quality, fetchTile);
    if (this.shadows) this.shadows.getShadowMap()!.refreshRate = 1;
    this.world.onMeshes = (meshes) => {
      for (const mesh of meshes) mesh.receiveShadows = true;
      const map = this.shadows?.getShadowMap();
      if (map) map.renderList!.push(...meshes.filter((mesh) => /plaster|roof|walls|gate/.test(mesh.name)));
    };
    this.plotsView = new PlotsView(scene, this.materials, (x, z) => this.world!.groundHeight(x, z), (mesh) => this.shadows?.addShadowCaster(mesh, false));
    this.plotsView.update(this.plotStates, Date.now());
    const spawn = getPlace("starter-home").door;
    await this.primeTiles(spawn[0], spawn[1]);
    this.assertLive();
    this.tracker = new StreetTracker(this.data.roads);
    this.navigator = new RoadNavigator(this.data.roads.filter((road) => road.kind !== "service" || road.name));

    this.callbacks.loading("Loading residents…", 0.65);
    void PropLibrary.load(scene).then((props) => {
      if (this.disposed) return;
      this.props = props;
      this.placeStreetProps(props);
      this.plotsView?.setProps(props);
    });
    try {
      this.avatars = await AvatarFactory.load(scene);
    } catch {
      this.callbacks.notice({ tone: "error", text: "Character model failed to load — using a placeholder." });
    }
    this.assertLive();
    this.callbacks.loading("Loading danfos…", 0.8);
    try {
      this.danfos = await DanfoFactory.load(scene);
    } catch {
      this.callbacks.notice({ tone: "error", text: "Danfo model failed to load — using a placeholder." });
    }
    this.assertLive();
    if (this.avatars) {
      this.player = this.avatars.create("player", this.appearance);
      this.player.setBuild(this.build);
      this.player.onMeshes = (meshes) => this.addCaster(meshes);
    } else {
      this.playerFallback = MeshBuilder.CreateCapsule("player", { height: 1.76, radius: 0.3 }, scene);
    }
    this.parcel = MeshBuilder.CreateBox("parcel", { width: 0.42, height: 0.3, depth: 0.32 }, scene);
    const cardboard = new PBRMaterial("cardboard", scene);
    cardboard.albedoColor = Color3.FromHexString("#b0844f");
    cardboard.roughness = 0.9;
    this.parcel.material = cardboard;
    this.parcel.setEnabled(false);

    this.callbacks.loading("Loading vehicles…", 0.85);
    // Only what is on screen at start; owned and passing cars download when they first appear.
    const startModels = [...trafficModels(this.quality), RIDE.modelId, BIKE_RENTAL.modelId, TOW.truckModelId, "toyota-hilux", "banana-island-lx", "island-suv"];
    this.vehicleFactory = await VehicleFactory.load(scene, this.materials, startModels);
    this.assertLive();
    this.life = new AmbientLife(scene, this.world, this.data.roads, this.avatars, this.quality, this.vehicleFactory);
    this.life.onHonk = () => {
      this.audio.horn(0.8);
      this.caption("A car honks — you are blocking the road");
    };
    buildServiceBay(scene, getPlace("ade-auto-works"), (x, z) => this.world.groundHeight(x, z));
    this.showroom = this.buildShowroom(this.vehicleFactory);
    this.bikeStations = new BikeStationsView(scene, this.materials, (x, z) => this.world.groundHeight(x, z), this.vehicleFactory, (meshes) => this.addCaster(meshes));
    this.entrances = new EntranceMarkers(scene, (x, z) => this.world.groundHeight(x, z));
    this.listingBoards = new ListingBoards(scene);
    this.couriers = new Couriers(scene, () => this.avatars, () => this.vehicleFactory, () => this.navigator ?? null, (x, z) => this.world.groundHeight(x, z), (meshes) => this.addCaster(meshes));
    if (this.avatars) this.homeStaff = new HomeStaffView(this.avatars, (x, z) => this.world.groundHeight(x, z), (meshes) => this.addCaster(meshes));
    if (this.avatars) this.crews = new StreetCrews(scene, this.avatars, this.vehicleFactory, (x, z) => this.world.groundHeight(x, z), (meshes) => this.addCaster(meshes));
    if (this.avatars) {
      this.spotters = new CarSpotters(
        this.avatars,
        this.overlay,
        (x, z) => this.world.groundHeight(x, z),
        (x, z) => walkable(x, z) && this.navigator.snap([x, z]).distance > 4.5,
        (x, y, z) => this.project(x, y, z),
        (text) => this.callbacks.notice({ tone: "success", text }),
        (amount) => this.callbacks.spray(amount),
      );
      this.spotters.enabled = this.settings.carSpotters;
    }

    this.input = new InputState(this.canvas, this.bindings);
    const start = getPlace("starter-home");
    this.controller.teleport(start.door[0], start.door[1]);
    this.controller.yaw = start.facing;
    this.cameraYaw = start.facing;
    this.snapCamera();

    this.callbacks.loading("Connecting to the city…", 0.92);
    void this.net.connect();
    scene.onBeforeRenderObservable.add(() => {
      const t0 = performance.now();
      try {
        this.update();
      } catch (error) {
        this.frameError(error);
      }
      this.updateMs = this.updateMs * 0.9 + (performance.now() - t0) * 0.1;
    });
    // Without CPU copies of the world's vertices a restored context would come back empty.
    engine.onContextLostObservable.add(() => this.callbacks.graphics(MeshBuilderBatch.keepCpuCopies ? "lost" : "failed"));
    engine.onContextRestoredObservable.add(() => this.callbacks.graphics("restored"));
    // Babylon only queues the next frame after this callback returns, so one thrown error would freeze the game for good.
    // Phones and tablets heat up and throttle (then stutter) at 60-120 fps; 30 fps on low/medium keeps them cool.
    const frameGap = (this.frameGap = matchMedia("(pointer: coarse)").matches && this.quality !== "high" ? 1000 / 30 - 3 : 0);
    let lastFrame = 0;
    engine.runRenderLoop(() => {
      if (this.disposed) return;
      if (frameGap && performance.now() - lastFrame < frameGap) return;
      lastFrame = performance.now();
      const counter = (engine as unknown as { _drawCalls?: { current: number } })._drawCalls;
      const before = counter?.current ?? 0;
      const t0 = performance.now();
      try {
        scene.render();
      } catch (error) {
        this.frameError(error);
      }
      this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
      this.frameDrawCalls = (counter?.current ?? 0) - before;
    });
    window.addEventListener("resize", this.resize);
    if (import.meta.env.DEV || import.meta.env.VITE_TEST_HOOKS === "true") this.installTestHooks();
  }

  private resize = () => this.engine?.resize();

  private frameErrors = { count: 0, loggedAt: 0, firstAt: 0, told: false };

  /** Keeps the loop alive after a bad frame; persistent failures ask the UI to restart the graphics. */
  private frameError(error: unknown) {
    const now = performance.now();
    const errors = this.frameErrors;
    if (now - errors.loggedAt > 5_000) {
      console.error("Frame error", error);
      errors.loggedAt = now;
      if (now - errors.firstAt > 15_000) {
        errors.firstAt = now;
        errors.count = 0;
      }
    }
    errors.count += 1;
    if (!errors.told) {
      errors.told = true;
      this.callbacks.notice({ tone: "info", text: "Something glitched, but the game kept running. If you are stuck, open Phone → Help → Get unstuck." });
    }
    if (errors.count > 600) {
      errors.count = 0;
      this.callbacks.graphics("failed");
    }
  }

  /** Loads and builds the tiles around a point before the player sees it (start-up). */
  private async primeTiles(x: number, z: number) {
    const deadline = performance.now() + 60_000;
    this.world.stream(x, z);
    while (this.world.pendingNear() > 0 && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      this.assertLive();
      this.world.stream(x, z);
      this.world.pump(200);
    }
  }

  private onLand(x: number, z: number) {
    return withinWorld(x, z) && !blockedByWater(x, z);
  }

  private addCaster(meshes: AbstractMesh[]) {
    if (!this.shadows) return;
    for (const mesh of meshes) this.shadows.addShadowCaster(mesh, false);
  }

  /** Two of the cars on sale, angled toward Admiralty Way either side of the clear path to the door. */
  private buildShowroom(factory: VehicleFactory) {
    const place = getPlace(TEST_DRIVE.dealerPlaceId);
    const [dx, dz] = place.door;
    const fx = Math.sin(place.facing);
    const fz = Math.cos(place.facing);
    const rx = Math.cos(place.facing);
    const rz = -Math.sin(place.facing);
    const lots = [
      { modelId: "banana-island-lx", side: -1 },
      { modelId: "island-suv", side: 1 },
    ];
    const forecourt = lots.map(({ modelId, side }, index) => {
      const model = getVehicleModel(modelId);
      const view = factory.create(`showroom-${index}`, modelId, model.colours[(index * 3 + 3) % model.colours.length]!);
      const x = dx + fx * 4.2 + rx * side * 5.4;
      const z = dz + fz * 4.2 + rz * side * 5.4;
      view.setPose(x, this.world.groundHeight(x, z), z, place.facing + side * 0.55);
      this.addCaster(view.meshes);
      return view;
    });
    this.fillShowroomFloor(factory, place);
    return forecourt;
  }

  private updateCompoundCars(now: number) {
    const factory = this.vehicleFactory;
    if (!factory || now - this.lastCompoundCheck < 1000) return;
    this.lastCompoundCheck = now;
    COMPOUND_PLACES.forEach((place, index) => {
      const distance = Math.hypot(place.door[0] - this.controller.x, place.door[1] - this.controller.z);
      const shown = this.compoundViews.get(place.id);
      if (shown && distance > 320) {
        for (const view of shown) view.dispose();
        this.compoundViews.delete(place.id);
        return;
      }
      if (shown || distance > 240) return;
      const views: VehicleView[] = [];
      this.compoundViews.set(place.id, views);
      const cars = compoundCars(place, index);
      void Promise.all(cars.map(({ modelId }) => factory.ensure(modelId))).then(() => {
        if (this.disposed || this.compoundViews.get(place.id) !== views) return;
        cars.forEach((car, slot) => {
          const model = getVehicleModel(car.modelId);
          const view = factory.create(`compound ${place.id} ${slot}`, car.modelId, model.colours[(index + slot * 2) % model.colours.length]!);
          view.setPose(car.x, this.world.groundHeight(car.x, car.z), car.z, car.yaw);
          views.push(view);
        });
      });
    });
  }

  /** Display cars behind the showroom glass, angled to the street; only spots well inside the building are used. */
  private fillShowroomFloor(factory: VehicleFactory, place: Place) {
    const [dx, dz] = place.door;
    const [fx, fz] = [Math.sin(place.facing), Math.cos(place.facing)];
    const [rx, rz] = [Math.cos(place.facing), -Math.sin(place.facing)];
    const spots: Array<{ x: number; z: number; yaw: number }> = [];
    for (const depth of [5, 10.5]) {
      for (const across of [-7.5, -2.5, 2.5, 7.5]) {
        const x = dx - fx * depth + rx * across;
        const z = dz - fz * depth + rz * across;
        if (!insideBuilding(x, z, 2.8) || spots.some((spot) => Math.hypot(spot.x - x, spot.z - z) < 4.8)) continue;
        spots.push({ x, z, yaw: place.facing + (across < 0 ? 0.6 : -0.6) });
      }
    }
    const models = ["mercedes-g63", "range-rover", "lexus-rx350", "toyota-camry", "mercedes-s-class", "toyota-land-cruiser"].slice(0, spots.length);
    void Promise.all(models.map((modelId) => factory.ensure(modelId))).then(() => {
      if (this.disposed) return;
      models.forEach((modelId, index) => {
        const spot = spots[index]!;
        const model = getVehicleModel(modelId);
        const view = factory.create(`showroom-floor-${index}`, modelId, model.colours[index % model.colours.length]!);
        view.setPose(spot.x, this.world.groundHeight(spot.x, spot.z) + 0.08, spot.z, spot.yaw);
        view.setDetail(true);
        this.showroom.push(view);
      });
    });
  }

  private collide(x: number, z: number): [number, number] {
    if (this.interior) return this.interior.collide(x, z, MOVEMENT.radius);
    let [px, pz] = resolveBuildingCollision(x, z, MOVEMENT.radius);
    [px, pz] = this.world.obstacles.resolve(px, pz, MOVEMENT.radius);
    for (const bus of this.buses.values()) [px, pz] = bus.pushOut(px, pz, MOVEMENT.radius);
    for (const { view } of this.vehicles.values()) [px, pz] = view.pushOut(px, pz, MOVEMENT.radius);
    for (const view of this.showroom) [px, pz] = view.pushOut(px, pz, MOVEMENT.radius);
    for (const views of this.compoundViews.values()) for (const view of views) [px, pz] = view.pushOut(px, pz, MOVEMENT.radius);
    const { x: ox, z: oz } = this.controller;
    // Open water and the district edges stop residents; slide along them, and never trap someone already outside.
    if (!this.onLand(px, pz) && this.onLand(ox, oz)) {
      if (this.onLand(px, oz)) pz = oz;
      else if (this.onLand(ox, pz)) px = ox;
      else [px, pz] = [ox, oz];
    }
    return [px, pz];
  }

  /** Circle resolver for the driven car: buildings, street furniture, danfos and other vehicles. */
  private collideCar = (x: number, z: number, radius: number): [number, number] => {
    let [px, pz] = resolveBuildingCollision(x, z, radius);
    [px, pz] = this.world.obstacles.resolve(px, pz, radius);
    for (const bus of this.buses.values()) [px, pz] = bus.pushOut(px, pz, radius);
    for (const [id, { view }] of this.vehicles) {
      if (id !== this.driving?.vehicleId && id !== this.rideCar?.vehicleId) [px, pz] = view.pushOut(px, pz, radius);
    }
    for (const view of this.showroom) [px, pz] = view.pushOut(px, pz, radius);
    for (const views of this.compoundViews.values()) for (const view of views) [px, pz] = view.pushOut(px, pz, radius);
    // Water and district edges count as a fixed overlap, so the car stops at the shore but can always reverse off it.
    if (!this.onLand(px, pz)) return [px + radius, pz];
    return [px, pz];
  };

  private updateDriving(dt: number, now: number) {
    const car = this.car!;
    const driving = this.driving!;
    let throttle = 0;
    let steer = 0;
    if (this.input.held("forward")) throttle += 1;
    if (this.input.held("back")) throttle -= 1;
    if (this.input.held("right")) steer += 1;
    if (this.input.held("left")) steer -= 1;
    const pedals = this.input.touchDrive;
    if (pedals) {
      throttle = pedals.brake > 0 ? -pedals.brake : pedals.throttle;
      steer = pedals.steer;
    } else if (this.input.touchMove[0] || this.input.touchMove[1]) [steer, throttle] = this.input.touchMove;
    const pilot = this.runCarPilot(now);
    if (pilot) [throttle, steer] = pilot;
    if (this.flaggedDown) {
      if (this.carPilot) {
        this.carPilot.resolve(false);
        this.carPilot = null;
      }
      throttle = car.speed > 0.5 ? -1 : car.speed < -0.5 ? 1 : 0;
    }
    const handbrake = this.input.held("jump") || this.input.touchSprint || (this.flaggedDown && Math.abs(car.speed) < 3);
    const topSpeed = effectiveTopSpeed(car.model, driving.condition);
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP_DT));
    let impact = 0;
    for (let step = 0; step < steps; step += 1) {
      impact = Math.max(impact, car.step(dt / steps, { throttle, steer, handbrake }, topSpeed, this.collideCar));
    }
    if (dialSpeed(impact) >= VEHICLE_RULES.impactMinSpeed && now - this.lastContactAt > 600 && now - this.lastImpactSentAt > 900) {
      this.lastImpactSentAt = now;
      this.net.send("vehicleImpact", { speed: impact });
      this.audio.horn(0.15);
      this.caption("Crunch — your car hit something");
    }
    if (impact > 0.5) this.lastContactAt = now;
    car.yaw = Math.atan2(Math.sin(car.yaw), Math.cos(car.yaw));
    this.controller.teleport(car.x, car.z);
    this.controller.yaw = car.yaw;
    if (this.input.consume("stop")) this.honk();
    if (this.input.consume("lights")) this.toggleLights();
    if (this.input.consume("camera")) this.cycleCamera();
    if (this.input.consume("interact")) {
      if (Math.abs(car.speed) < 2) this.exitVehicle();
      else this.callbacks.notice({ tone: "info", text: "Slow down to step out." });
    }
    this.input.consume("jump");
  }

  private startDriving(vehicleId: string) {
    const entry = this.vehicles.get(vehicleId);
    if (!entry) {
      this.pendingDrive = vehicleId;
      return;
    }
    this.pendingDrive = null;
    this.car = new CarController(getVehicleModel(entry.state.modelId));
    this.car.place(this.self?.x ?? entry.state.x, this.self?.z ?? entry.state.z, entry.state.yaw);
    this.driving = { vehicleId, condition: this.driving?.vehicleId === vehicleId ? this.driving.condition : 100 };
    this.cameraYaw = entry.state.yaw;
    this.cameraPitch = 0.26;
    this.emote = null;
    if (this.autopilot) {
      this.autopilot.resolve(false);
      this.autopilot = null;
    }
  }

  private stopDriving() {
    this.lights = false;
    this.car = null;
    this.driving = null;
    this.pendingDrive = null;
    this.flaggedDown = false;
    if (this.carPilot) {
      this.carPilot.resolve(false);
      this.carPilot = null;
    }
  }

  private syncVehicles(list: WorldVehicle[], now: number) {
    if (!this.vehicleFactory) return;
    const seen = new Set<string>();
    for (const state of list) {
      seen.add(state.id);
      let entry = this.vehicles.get(state.id);
      if (!entry || entry.state.modelId !== state.modelId || entry.state.colour !== state.colour) {
        if (!this.vehicleFactory.ready(state.modelId)) {
          void this.vehicleFactory.ensure(state.modelId);
          continue;
        }
        entry?.view.dispose();
        entry?.tag.remove();
        entry?.driver?.dispose();
        entry?.rig?.dispose();
        const view = this.vehicleFactory.create(state.id, state.modelId, state.colour);
        this.addCaster(view.meshes);
        const tag = document.createElement("div");
        tag.className = "world-tag vehicle-tag";
        this.overlay.appendChild(tag);
        const taxi = state.id.startsWith("ride-");
        const dubai = regionOf(state.x, state.z) === "dubai";
        if (taxi) addTaxiLivery(view, dubai ? "dubai" : "lagos");
        const look = taxi ? (dubai ? dubaiDriverLook(state.id) : taxiDriverLook(state.id)) : undefined;
        entry = { view, state, tag, driver: state.npc && this.avatars ? this.avatars.create(`driver ${state.id}`, look) : null, rig: null };
        this.vehicles.set(state.id, entry);
        view.setPose(state.x, this.world.groundHeight(state.x, state.z), state.z, state.yaw);
      }
      entry.state = state;
      if (state.tow && !entry.rig) entry.rig = new TowRig(entry.view, this.vehicleFactory);
      if (state.id !== this.driving?.vehicleId) entry.view.setLights(state.lights);
      entry.tag.textContent = state.tow ? `${state.ownerName}${state.tow.carrying ? ` · ${state.tow.carrying.plate}` : ""}` : `${state.plate} · ${state.mine ? "Your car" : state.ownerName}`;
      if (state.driverSessionId || state.tow) entry.view.push(now, state.x, state.z, state.yaw);
    }
    for (const [id, entry] of this.vehicles) {
      if (seen.has(id) || id === this.driving?.vehicleId) continue;
      entry.rig?.dispose();
      entry.view.dispose();
      entry.tag.remove();
      entry.driver?.dispose();
      this.vehicles.delete(id);
    }
    if (this.pendingDrive && this.vehicles.has(this.pendingDrive)) this.startDriving(this.pendingDrive);
  }

  private updateVehicles(now: number, dt: number) {
    const { x: cx, z: cz } = this.controller;
    this.updateRideApproach(dt);
    this.bikeStations?.update(this.bikeStock, cx, cz, Boolean(this.interior));
    for (const [id, { view, state, driver, rig }] of this.vehicles) {
      let pose: { x: number; z: number; yaw: number } | null;
      const rideCar = this.rideCar?.vehicleId === id ? this.rideCar.car : null;
      const mine = (id === this.driving?.vehicleId && this.car) || rideCar;
      if (rideCar) pose = rideCar;
      else if (mine) pose = this.car;
      else if (state.driverSessionId || state.tow) pose = view.sample(now);
      else pose = state;
      if (pose) view.setPose(pose.x, this.interior ? -50 : this.world.groundHeight(pose.x, pose.z), pose.z, pose.yaw);
      view.root.setEnabled(!this.interior);
      if (this.interior) continue;
      const car = rideCar ?? this.car;
      if (mine && car) view.animate(dt, { speed: car.speed, steer: car.steer, braking: car.braking, accel: car.accel, yawRate: car.yawRate });
      else view.track(dt);
      if (driver) this.seatDriver(driver, view, dt);
      if (rig && state.tow) rig.update(dt, state.tow);
      view.setDetail(Math.hypot(view.x - cx, view.z - cz) < 35);
    }
  }

  /** Dev-only pure-pursuit driver along a road route, for automated tests. */
  private runCarPilot(now: number): [number, number] | null {
    const pilot = this.carPilot;
    const car = this.car;
    if (!pilot || !car) return null;
    if (now > pilot.deadline) {
      this.carPilot = null;
      pilot.resolve(false);
      return null;
    }
    let target = pilot.path[pilot.index]!;
    while (Math.hypot(target[0] - car.x, target[1] - car.z) < (pilot.index === pilot.path.length - 1 ? 3 : 6)) {
      pilot.index += 1;
      if (pilot.index >= pilot.path.length) {
        this.carPilot = null;
        pilot.resolve(true);
        return [car.speed > 0.5 ? -1 : 0, 0];
      }
      target = pilot.path[pilot.index]!;
    }
    const last = pilot.index === pilot.path.length - 1;
    let delta = Math.atan2(target[0] - car.x, target[1] - car.z) - car.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const recovery = pilot.recovery;
    if (recovery && now < recovery.until) return [-0.7, recovery.side];
    if (recovery && now < recovery.swerveUntil) return [car.speed < 3 ? 0.7 : 0, -recovery.side];
    pilot.recovery = null;
    if (Math.abs(car.speed) > 0.6) pilot.stuckSince = null;
    else if (pilot.stuckSince === null) pilot.stuckSince = now;
    else if (now - pilot.stuckSince > 1200) {
      // Three-point turn: reverse on one lock, then pull away on the other, alternating sides.
      const side = (pilot.recoveries % 2 === 0 ? 1 : -1) * (delta >= 0 ? -1 : 1);
      pilot.recoveries += 1;
      pilot.stuckSince = null;
      pilot.recovery = { until: now + 1800, swerveUntil: now + 3000, side };
    }
    const remaining = Math.hypot(target[0] - car.x, target[1] - car.z);
    const cruise = Math.abs(delta) > 0.6 ? 4 : last ? Math.min(8, 1.5 + remaining * 0.5) : 9;
    const throttle = car.speed < cruise ? 0.8 : car.speed > cruise + 1.5 ? -0.6 : 0;
    return [throttle, Math.max(-1, Math.min(1, delta * 2.2))];
  }

  private riding() {
    return this.self?.busId ? this.buses.get(this.self.busId) ?? null : null;
  }

  private update() {
    if (!this.world) return;
    const now = performance.now();
    const elapsed = this.lastUpdateAt ? now - this.lastUpdateAt : this.engine.getDeltaTime();
    this.lastUpdateAt = now;
    const dt = Math.min(this.maxFrameDt, elapsed / 1000);
    this.frameTimes.push(elapsed);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    if (this.readyFired && this.settings.autoGraphics && !document.hidden && !this.showcase) {
      // Under the 30 fps cap a steady frame is ~33 ms by design; judge load as if it were a 60 fps frame.
      const level = this.adaptive.sample(this.frameGap ? elapsed / 2 : elapsed, now);
      if (level !== null) this.applyQualityStep(level);
    }

    if (this.plotsView && now - this.lastPlotDraw > 500) {
      this.lastPlotDraw = now;
      this.plotsView.update(this.plotStates, Date.now());
    }

    if (this.input.consume("phone")) this.callbacks.toggle("phone");
    if (this.input.consume("map")) this.callbacks.toggle("map");
    if (this.input.consume("help")) this.callbacks.toggle("help");

    const sensitivity = 0.0026 * this.settings.mouseSensitivity;
    if (this.input.lookDX || this.input.lookDY) this.lastLookAt = now;
    this.cameraYaw += this.input.lookDX * sensitivity;
    this.cameraPitch += this.input.lookDY * sensitivity * (this.settings.invertY ? -1 : 1);
    this.cameraPitch = Math.max(-0.35, Math.min(1.15, this.cameraPitch));
    this.input.lookDX = 0;
    this.input.lookDY = 0;
    if (this.input.zoom) {
      this.cameraDistance = Math.max(2.2, Math.min(10, this.cameraDistance + this.input.zoom * 0.5));
      this.input.zoom = 0;
    }

    this.updateCompoundCars(now);
    const ridingId = this.self?.busId ?? null;
    for (const danfo of this.buses.values()) {
      const near = danfo.id === ridingId || Math.hypot(danfo.root.position.x - this.controller.x, danfo.root.position.z - this.controller.z) < DANFO_VISIBLE_RANGE;
      danfo.root.setEnabled(near);
      danfo.update(dt, now, near);
    }
    const bus = this.riding();
    if (bus) {
      this.controller.teleport(bus.root.position.x, bus.root.position.z);
      this.controller.yaw = bus.yaw;
      if (this.autopilot) {
        this.autopilot.resolve(false);
        this.autopilot = null;
      }
      if (this.input.consume("stop")) this.requestStop();
      if (this.input.consume("interact")) this.alight();
    } else if (this.car && this.driving) {
      this.updateDriving(dt, now);
    } else if (this.passenger) {
      const view = this.vehicles.get(this.passenger.vehicleId)?.view;
      const rideCar = this.driveRide(dt, now);
      if (rideCar) {
        this.controller.teleport(rideCar.x, rideCar.z);
        this.controller.yaw = rideCar.yaw;
      } else if (view) {
        this.controller.teleport(view.x, view.z);
        this.controller.yaw = view.yaw;
      }
      if (this.input.consume("interact")) this.exitVehicle();
      this.input.consume("stop");
      this.input.consume("jump");
    } else {
      let move: [number, number] = [0, 0];
      if (this.input.held("forward")) move[1] += 1;
      if (this.input.held("back")) move[1] -= 1;
      if (this.input.held("right")) move[0] += 1;
      if (this.input.held("left")) move[0] -= 1;
      if (this.input.touchMove[0] || this.input.touchMove[1]) move = [...this.input.touchMove];
      let mode: MoveMode = this.input.held("sprint") || this.input.touchSprint ? "sprint" : this.input.walkToggle ? "walk" : "jog";
      this.runAutopilot(now);
      if (this.forcedInput) {
        move = this.forcedInput;
        if (this.autopilot) mode = this.autopilot.sprint ? "sprint" : "jog";
      }
      if (this.travelView?.seated) {
        move = [0, 0];
        if (this.self) this.controller.teleport(this.self.x, this.self.z);
        this.controller.yaw = this.seatYaw;
      }
      if (move[0] || move[1]) this.emote = null;
      if (this.workout && (move[0] || move[1])) {
        this.workout = null;
        this.callbacks.notice({ tone: "info", text: "You stepped off. That set won't count unless you finish it at the machine." });
      }
      if (this.workout) {
        move = [0, 0];
        this.controller.teleport(this.workout.station.at[0], this.workout.station.at[1]);
      }
      if (this.repairing && performance.now() > this.repairing.until) this.repairing = null;
      if (this.repairing && this.repairSite) {
        move = [0, 0];
        this.controller.teleport(...this.repairSite.site.stand);
      }
      const steps = Math.max(1, Math.ceil(dt / SUBSTEP_DT));
      for (let step = 0; step < steps; step += 1) this.controller.step(dt / steps, move, this.cameraYaw, mode);
      if (this.input.consume("jump")) this.controller.jump();
      if (this.input.consume("interact")) this.interaction?.();
      this.input.consume("stop");
    }

    // Vehicles move first, so seated avatars and the camera use this frame's pose rather than trailing a frame behind.
    this.updateVehicles(now, dt);
    const { x, z } = this.controller;
    const targetGround = this.interior ? (this.travelView?.floor(x, z) ?? 0.02) : this.world.groundHeight(x, z);
    this.groundY += (targetGround - this.groundY) * Math.min(1, dt * 12);
    const inCar = Boolean(this.car && this.driving);
    const speed = inCar ? Math.abs(this.car!.speed) : this.controller.speed();
    const seatedTravel = Boolean(this.travelView?.seated);
    const motion: MotionState = inCar ? "drive" : this.passenger || seatedTravel ? "sit" : this.emote && speed < 0.1 ? this.emote : bus ? "sit" : this.controller.motion();
    const ride = inCar ? { vehicleId: this.driving!.vehicleId, seat: 0 } : this.passenger;
    const seatView = ride ? this.vehicles.get(ride.vehicleId)?.view : undefined;
    if (this.player && seatView && ride) {
      const seat = seatView.seat(ride.seat);
      this.player.root.position.set(seat.x, this.world.groundHeight(seat.x, seat.z) + seatView.seatHeight(ride.seat), seat.z);
      this.player.root.rotation.y = seat.yaw;
      this.player.root.setEnabled(true);
      const bike = seatView.model.body === "bicycle";
      this.player.update(0, ride.seat === 0 && !bike ? "drive" : "sit", dt);
      if (bike && ride.seat === 0) this.player.pedal(seatView.crank);
    } else if (this.player) {
      if (this.sitting && (speed > 0.1 || this.emote !== this.sitting.pose || !this.interior)) this.sitting = null;
      const chair = this.sitting;
      const lying = chair?.rest === "bed";
      const lean = chair?.pose === "sit" && !lying ? 0.08 : 0;
      if ((chair?.rest ?? null) !== this.restingAs) {
        this.restingAs = chair?.rest ?? null;
        this.callbacks.resting?.(this.restingAs);
      }
      this.player.root.rotation.x = lying ? -Math.PI / 2 : 0;
      const workout = this.workout;
      if (workout) {
        const { station } = workout;
        workout.time += dt;
        this.player.root.position.set(station.at[0], this.groundY + station.lift, station.at[1]);
        this.player.root.rotation.y = station.yaw;
        this.player.root.setEnabled(true);
        this.player.update(station.speed, station.motion, dt);
        this.player.exercise(station.exercise, workout.time);
      } else if (this.repairing && this.repairSite) {
        this.repairing.time += dt;
        const [sx, sz] = this.repairSite.site.stand;
        this.player.root.position.set(sx, this.groundY, sz);
        this.player.root.rotation.y = this.repairSite.site.faceYaw;
        this.player.root.setEnabled(true);
        this.player.update(0, "idle", dt);
        this.player.exercise("repair", this.repairing.time);
      } else {
        if (chair) this.player.root.position.set(chair.seat[0] + Math.sin(chair.yaw) * lean, chair.y, chair.seat[1] + Math.cos(chair.yaw) * lean);
        else this.player.root.position.set(x, seatedTravel ? TRAVEL_SEAT_Y : this.groundY + this.controller.hop, z);
        this.player.root.rotation.y = chair ? chair.yaw : seatedTravel ? this.seatYaw : this.controller.yaw;
        this.player.root.setEnabled(!bus && !inCar);
        if (!inCar) this.player.update(speed, lying ? "idle" : motion, dt);
      }
    } else if (this.playerFallback) {
      this.playerFallback.position.set(x, this.groundY + 0.88, z);
      this.playerFallback.setEnabled(!bus && !inCar);
    }
    if (this.parcel?.isEnabled()) {
      const yaw = this.controller.yaw;
      this.parcel.position.set(x + Math.sin(yaw) * 0.32, this.groundY + 1.08, z + Math.cos(yaw) * 0.32);
      this.parcel.rotation.y = yaw;
    }

    this.updateFlight(dt);
    if (this.showcase) this.updateShowcaseCamera(dt);
    else if (this.flightShot) {
      this.camera.fov = 0.62;
      this.camera.position.copyFrom(this.flightShot.eye);
      this.camera.setTarget(this.flightShot.look);
    } else {
      this.camera.fov = 0.95;
      this.updateCamera(dt, bus);
    }
    if (!bus && !seatedTravel && now - this.lastSend > 66) {
      const moved = Math.hypot(x - this.lastSent.x, z - this.lastSent.z) > 0.02 || motion !== this.lastSent.motion;
      if (moved || now - this.lastSend > 1000) {
        this.net.sendPosition(x, z, this.controller.yaw, motion);
        this.lastSent = { x, z, motion };
        this.lastSend = now;
      }
    }

    this.updateRemotes(now, dt);
    this.repairSite?.site.update(now / 1_000);
    this.interior?.update(now * 0.001);
    this.updateWaiters(dt);
    if (!this.staff.idle) this.staff.update(dt, [this.controller.x, this.controller.z], now * 0.001);
    if (now - this.boardsAt > 1_000) {
      this.boardsAt = now;
      this.listingBoards?.update(this.world.placeSigns, this.listingLabels);
    }
    this.couriers?.update(dt, { x: this.controller.x, z: this.controller.z, location: this.self?.location ?? "street" });
    const leaderView = seatView && ride ? seatView : null;
    this.updateEscorts(dt, {
      x: leaderView ? leaderView.x : x,
      z: leaderView ? leaderView.z : z,
      yaw: leaderView ? leaderView.yaw : this.controller.yaw,
      driving: Boolean(leaderView),
      outdoors: !this.interior && !bus,
    });
    this.crews?.update(dt, x, z, !this.interior);
    if (this.homeStaff) {
      if (now - this.staffPostsAt > 1000) {
        this.staffPostsAt = now;
        this.staffPosts = this.interior ? [] : this.staffPostsNear(x, z);
      }
      this.homeStaff.update(dt, this.staffPosts);
    }
    this.partyLights?.update(now * 0.001);
    const guideSpot = this.interior && !seatedTravel && this.indoorGuide ? this.interior.spots.find((spot) => spot.id === this.indoorGuide!.spot) : undefined;
    const indoorTarget = guideSpot && guideSpot.id !== "exit" ? { key: guideSpot.id, point: guideSpot.point, name: this.indoorGuide!.label, title: "NEXT STEP" } : null;
    if (this.tour && !this.interior && this.playerRegion() !== "dubai") this.endTour();
    if (this.tour) {
      this.tour.update(dt, [x, z], !this.interior && !bus);
      if (this.tour.done) this.endTour();
    }
    const tourStop = this.tour?.stop;
    const outdoorTarget = this.waypointDoor ?? (tourStop ? { key: `tour:${tourStop.id}`, point: tourStop.point, name: tourStop.name, title: "TOUR STOP" } : null);
    this.entrances?.update(dt, [x, z], !this.interior && !bus && !seatedTravel, () => this.entranceCandidates(), this.interior && !seatedTravel ? (this.interior.spots.find((spot) => spot.id === "exit")?.point ?? null) : null, this.interior ? indoorTarget : outdoorTarget, this.camera.maxZ);
    this.updateGuideLine([x, z], guideSpot?.point ?? null);
    this.spotters?.update(dt, now, this.spottedCar(x, z), [x, z], !this.interior && !bus);
    this.updateTout(dt, now, x, z);
    this.plotsView?.animate(dt);
    this.updateGates(x, z);
    if (!this.interior) {
      this.world.stream(x, z);
      this.world.pump(!this.readyFired ? 200 : this.transfer ? 40 : 8);
      this.life?.update(dt, [x, z], [...this.buses.values()], now * 0.001);
      this.world.updateDetail(this.camera.position.x, this.camera.position.z);
    }
    if (this.shadows) {
      this.sun.position.copyFrom(new Vector3(x, 0, z).subtract(this.sun.direction.scale(120)));
    }
    if (now - this.lastInteract > 100) {
      this.lastInteract = now;
      this.updateInteractions(bus);
    }
    this.updateWaypoint(now);
    this.updateTransfer(now);
    this.updateTags();
    const busy = this.interior ? 0 : Math.max(0, 1 - (this.world.roads.nearest(x, z, (road) => road.kind === "primary")?.distance ?? 200) / 90);
    this.audio.update(now, busy);
    if (now - this.lastHud > 160) {
      this.lastHud = now;
      this.emitHud(now, bus, motion);
    }
    if (!this.readyFired && this.self && (this.interior || this.world.pendingNear() === 0)) {
      this.readyFired = true;
      this.callbacks.loading("Ready", 1);
      this.callbacks.ready();
    }
  }

  /** Vertex-coloured gradient dome: cheap, and independent of HDR prefiltering support on the GPU. */
  private createSky(scene: Scene) {
    const dome = MeshBuilder.CreateSphere("sky dome", { diameter: 1400, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    const positions = dome.getVerticesData(VertexBuffer.PositionKind)!;
    const colors: number[] = [];
    const zenith = Color3.FromHexString("#4f8fcf");
    const upper = Color3.FromHexString("#8dbbe3");
    const horizon = Color3.FromHexString("#e3e8e4");
    const ground = Color3.FromHexString("#c9c2b2");
    for (let index = 0; index < positions.length; index += 3) {
      const h = positions[index + 1]! / 700;
      const color = h < 0 ? ground : h < 0.18 ? Color3.Lerp(horizon, upper, h / 0.18) : Color3.Lerp(upper, zenith, Math.min(1, (h - 0.18) / 0.6));
      colors.push(color.r, color.g, color.b, 1);
    }
    dome.setVerticesData(VertexBuffer.ColorKind, colors);
    const material = new StandardMaterial("sky", scene);
    material.disableLighting = true;
    material.emissiveColor = Color3.White();
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.fogEnabled = false;
    dome.material = material;
    dome.infiniteDistance = true;
    dome.applyFog = false;
    dome.isPickable = false;
    dome.renderingGroupId = 0;
  }

  private snapCamera() {
    this.cameraTarget.set(this.controller.x, 1.55, this.controller.z);
    if (this.interior) return;
    const free = (yaw: number) => {
      for (let d = 0.5; d <= this.cameraDistance; d += 0.25) {
        const px = this.controller.x - Math.sin(yaw) * d;
        const pz = this.controller.z - Math.cos(yaw) * d;
        if (insideBuilding(px, pz, 0.3)) return d;
      }
      return this.cameraDistance;
    };
    if (free(this.cameraYaw) >= this.cameraDistance) return;
    let best = this.cameraYaw;
    let bestFree = 0;
    for (const offset of [0.5, -0.5, 1.0, -1.0, 1.57, -1.57, 2.1, -2.1, Math.PI]) {
      const distance = free(this.cameraYaw + offset);
      if (distance > bestFree + 0.01) {
        best = this.cameraYaw + offset;
        bestFree = distance;
        if (distance >= this.cameraDistance) break;
      }
    }
    this.cameraYaw = best;
  }

  cycleCamera() {
    const next = VEHICLE_VIEWS[(VEHICLE_VIEWS.indexOf(this.vehicleView) + 1) % VEHICLE_VIEWS.length]!;
    this.vehicleView = next;
    localStorage.setItem("lagos-vehicle-camera", next);
    this.cameraReach = 0;
    if (this.car || this.passenger) this.caption(VEHICLE_VIEW_LABEL[next]);
    return next;
  }

  /**
   * The one camera controller. Each mode (on foot, driving or riding, danfo, indoors) only chooses a
   * target and distance; yaw and pitch belong to the player, apart from an optional gentle drift back
   * behind a moving vehicle once they stop looking around. Enter/exit set the yaw once, elsewhere.
   */
  private updateCamera(dt: number, bus: DanfoView | null) {
    if (this.planShare && this.interior && !this.travelView) {
      const { minX, maxX, minZ, maxZ } = (this.interior as InteriorView).bounds;
      const [ox, oz] = [(minX + maxX) / 2, (minZ + maxZ) / 2];
      const engine = this.scene.getEngine();
      const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight() * this.planShare);
      const tan = Math.tan(this.camera.fov / 2);
      const height = Math.max((maxZ - minZ) / 2 + 0.6, ((maxX - minX) / 2 + 0.6) / aspect) / tan + 3;
      this.camera.position.set(ox, height, oz - 0.01);
      this.camera.setTarget(new Vector3(ox, 0, oz));
      return;
    }
    const rideView = !this.driving && this.passenger ? this.vehicles.get(this.passenger.vehicleId)?.view : undefined;
    const car = this.driving && this.car ? this.car : rideView ? { x: rideView.x, z: rideView.z, yaw: rideView.yaw, speed: rideView.speed, model: rideView.model } : null;
    const view = car ? this.vehicleView : null;
    const restPitch = view === "far" ? 0.34 : 0.26;
    const idle = performance.now() - this.lastLookAt;
    if (car && this.settings.cameraRecentre !== false && idle > RECENTRE_IDLE_MS && Math.abs(car.speed) > 3) {
      const ramp = Math.min(1, (idle - RECENTRE_IDLE_MS) / 1_500);
      let delta = car.yaw - this.cameraYaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.cameraYaw += delta * Math.min(1, dt * 1.8 * ramp);
      this.cameraPitch += (restPitch - this.cameraPitch) * Math.min(1, dt * 1.2 * ramp);
    }
    const cosPitch = Math.cos(this.cameraPitch);
    const dir = new Vector3(Math.sin(this.cameraYaw) * cosPitch, Math.sin(this.cameraPitch), Math.cos(this.cameraYaw) * cosPitch);
    const target = bus
      ? new Vector3(bus.root.position.x, 2.1, bus.root.position.z)
      : car
        ? new Vector3(car.x, this.groundY + Math.max(1.2, car.model.height * 0.9), car.z)
        : new Vector3(this.controller.x, this.groundY + 1.55, this.controller.z);
    const lag = 1 - Math.exp(-dt * (car ? 12 : 20));
    this.cameraTarget.addInPlace(target.subtract(this.cameraTarget).scale(lag));
    const chase = car ? (car.model.length * 1.15 + 2.6 + Math.abs(car.speed) * 0.08) * (view === "far" ? 1.6 : 1) : 8.5;
    const travel = this.travelView;
    const roomy = travel && (travel.kind.startsWith("airport") || travel.kind === "rooftop" || travel.kind === "dhow" || travel.kind === "safari");
    const distance = bus || car ? Math.max(this.cameraDistance, chase) : roomy ? this.cameraDistance : this.interior ? Math.min(this.cameraDistance, 3.6) : this.cameraDistance;
    let allowed = distance;
    if (this.interior) {
      const [ox, oz] = INTERIOR_ORIGIN;
      const room = travel ? null : (this.interior as InteriorView).bounds;
      const [limitX, limitZ] = travel ? [travel.half[0] - 0.2, travel.half[1] - 0.2] : [0, 0];
      const open = travel?.kind === "rooftop" || travel?.kind === "dhow" || travel?.kind === "safari";
      for (let d = 0.4; d <= distance; d += 0.2) {
        const px = this.cameraTarget.x - dir.x * d;
        const pz = this.cameraTarget.z - dir.z * d;
        const outside = room
          ? px < room.minX + 0.3 || px > room.maxX - 0.3 || pz < room.minZ + 0.3 || pz > room.maxZ - 0.3
          : Math.abs(px - ox) > limitX || Math.abs(pz - oz) > limitZ;
        if (!open && outside) {
          allowed = Math.max(0.5, d - 0.2);
          break;
        }
      }
    } else if (!bus) {
      for (let d = 0.4; d <= distance; d += 0.25) {
        const px = this.cameraTarget.x - dir.x * d;
        const pz = this.cameraTarget.z - dir.z * d;
        const py = this.cameraTarget.y + dir.y * d;
        const inBus = py < 3 && [...this.buses.values()].some((danfo) => {
          const [bx, bz] = danfo.pushOut(px, pz, 0.25);
          return bx !== px || bz !== pz;
        });
        if (inBus || this.life?.carAt(px, py, pz) || (py < 9 && resolveBuildingCollision(px, pz, 0.25).some((value, index) => Math.abs(value - (index ? pz : px)) > 0.01))) {
          allowed = Math.max(0.6, d - 0.3);
          break;
        }
      }
    }
    // Pull in at once (never through a wall) but ease back out, so passing posts and parked cars don't make it pump.
    this.cameraReach = allowed < this.cameraReach || this.cameraReach <= 0 ? allowed : Math.min(allowed, this.cameraReach + dt * 5);
    // Positive pitch lifts the camera above the target, looking down (matching the obstruction probe above).
    const position = this.cameraTarget.add(new Vector3(-dir.x, dir.y, -dir.z).scale(this.cameraReach));
    position.y = Math.max(position.y, (this.interior ? 0.3 : this.groundY + 0.35));
    if (this.interior) position.y = Math.min(position.y, this.travelView ? (this.travelView.kind === "rooftop" || this.travelView.kind === "dhow" || this.travelView.kind === "safari" ? 8 : this.travelView.height - 0.15) : 2.45);
    this.cameraPosition.copyFrom(position);
    this.camera.position.copyFrom(position);
    this.camera.setTarget(this.cameraTarget);
  }

  private updateInteractions(bus: DanfoView | null) {
    this.interaction = null;
    this.prompt = null;
    this.secondary = null;
    const { x, z } = this.controller;
    const bind = (action: keyof Bindings) => this.bindings[action].replace("Key", "");
    if (bus) {
      const state = bus.state;
      if (state?.doorOpen && state.stopId) {
        this.prompt = { key: bind("interact"), label: "Step off", detail: stopById.get(state.stopId)?.name };
      } else {
        this.prompt = { key: bind("interact"), label: "Request stop & step off at next stop" };
      }
      this.secondary = state?.stopRequested ? { key: "✓", label: "Stop requested" } : { key: bind("stop"), label: "Request stop (Owa o!)" };
      return;
    }
    if (this.car && this.driving) {
      const plate = this.vehicles.get(this.driving.vehicleId)?.state.plate;
      const hired = Boolean(this.vehicles.get(this.driving.vehicleId)?.state.rentalStartedAt);
      const dock = hired ? nearestBikeStation(this.car.x, this.car.z) : null;
      const docking = dock && dock.distance <= BIKE_RENTAL.returnRange;
      this.prompt = Math.abs(this.car.speed) < 2
        ? { key: bind("interact"), label: docking ? "Dock the bike & end the hire" : hired ? "Lock the bike here" : "Step out & park here", detail: docking ? dock.station.name : plate }
        : { key: "…", label: "Slow down to step out", disabled: true };
      this.interaction = () => this.exitVehicle();
      const mechanic = getPlace("ade-auto-works");
      const bay = serviceBay(mechanic);
      const testCar = Boolean(this.vehicles.get(this.driving.vehicleId)?.state.testDriveEndsAt);
      if (!hired && !testCar && Math.hypot(this.car.x - bay.x, this.car.z - bay.z) < BAY_SIZE.length) {
        if (Math.abs(this.car.speed) < 1.5) {
          this.prompt = { key: bind("interact"), label: "Stop in the service bay · get a repair quote", detail: `${mechanic.name} · ${this.driving.condition}% condition` };
          this.interaction = () => {
            this.exitVehicle();
            setTimeout(() => this.callbacks.interact({ kind: "place", place: mechanic }), 900);
          };
        } else {
          this.prompt = { key: "…", label: "Pull into the service bay and stop", detail: mechanic.name, disabled: true };
        }
      }
      this.secondary = { key: bind("stop"), label: "Horn" };
      return;
    }
    if (this.passenger && this.ride?.status === "riding" && this.ride.vehicleId === this.passenger.vehicleId) {
      const ride = this.ride;
      this.prompt = { key: "📱", label: `Riding to ${ride.label}`, detail: `${ride.driverName} · ${ride.plate} · Phone → Ride to stop early`, disabled: true };
      this.interaction = () => undefined;
      return;
    }
    if (this.passenger) {
      const entry = this.vehicles.get(this.passenger.vehicleId);
      const moving = Math.abs(entry?.view.speed ?? 0) >= 2;
      this.prompt = moving
        ? { key: "…", label: "Riding as a passenger", detail: "Step out when the vehicle stops", disabled: true }
        : { key: bind("interact"), label: "Step out", detail: entry ? `${entry.state.ownerName}'s ${entry.view.model.name}` : undefined };
      this.interaction = () => this.exitVehicle();
      return;
    }
    if (this.travelView?.seated) {
      const flight = this.trip.flight;
      const excursion = this.trip.excursion;
      if (flight) {
        const left = Math.max(0, Math.ceil((flight.arriveAt - Date.now() - this.serverOffset) / 1000));
        this.prompt = { key: "✈", label: `${flight.code} ${flight.label} · ${left}s`, detail: `Seat ${flight.seat} · look around, or skip the flight`, disabled: true };
      } else if (excursion) {
        const left = Math.max(0, Math.ceil((excursion.endsAt - Date.now() - this.serverOffset) / 1000));
        this.prompt = { key: "⛵", label: excursion.activity === "dhow-cruise" ? `Dhow cruise · ${left}s` : `Desert safari · ${left}s`, detail: "Sit back and look around", disabled: true };
      }
      this.interaction = () => undefined;
      return;
    }
    if (this.interior) {
      const travel = this.travelView;
      const chair = this.sitting;
      if (chair?.stool) {
        const dancing = chair.pose === "dance";
        this.prompt = { key: bind("interact"), label: dancing ? "Climb down" : "Climb up and dance", detail: dancing ? "Back to your seat" : "Stand on the stool" };
        this.interaction = () => this.stoolDance(!dancing);
        return;
      }
      if (chair) {
        this.prompt = { key: bind("interact"), label: chair.rest === "bed" ? "Get up" : "Stand up", detail: chair.rest && chair.rest !== "bed" ? "Resting restores energy" : undefined };
        this.interaction = () => this.playEmote("none");
        return;
      }
      const parcel = this.couriers?.reachable({ x, z, location: this.self?.location ?? "street" });
      if (parcel) {
        this.prompt = { key: bind("interact"), label: `Take your ${parcel.emoji} ${parcel.name}`, detail: "The rider is at your door" };
        this.interaction = () => this.callbacks.interact({ kind: "parcel", parcelId: parcel.id });
        return;
      }
      const reach = travel ? 2.2 : 1.6;
      let nearest: { spot: InteriorSpot | { id: string; point: Vec2; label: string }; distance: number } | null = null;
      for (const spot of this.interior.spots) {
        const distance = Math.hypot(spot.point[0] - x, spot.point[1] - z);
        if (distance < reach && (!nearest || distance < nearest.distance)) nearest = { spot, distance };
      }
      if (nearest) {
        const spot = nearest.spot;
        this.prompt = { key: bind("interact"), label: spot.label };
        this.interaction =
          spot.id === "exit"
            ? () => this.exitProperty()
            : spot.id === "stool" && !travel
              ? () => this.clubSeat("stool")
              : travel
                ? () => this.callbacks.interact({ kind: "travel", interior: travel.kind, spot: spot.id })
                : () => this.callbacks.interact({ kind: "interior", spot: spot.id as InteriorSpot["id"] });
      }
      return;
    }
    let best: { distance: number; prompt: Prompt; run: () => void } | null = null;
    const offer = (distance: number, prompt: Prompt, run: () => void) => {
      if (!best || distance < best.distance) best = { distance, prompt, run };
    };
    const parcel = this.couriers?.reachable({ x, z, location: "street" });
    if (parcel) offer(-5, { key: bind("interact"), label: `Take your ${parcel.emoji} ${parcel.name}`, detail: "From the delivery rider" }, () => this.callbacks.interact({ kind: "parcel", parcelId: parcel.id }));
    for (const danfo of this.buses.values()) {
      const [dx, dz] = danfo.doorPoint();
      const distance = Math.hypot(dx - x, dz - z);
      if (distance > 5.2) continue;
      const state = danfo.state;
      if (!state) continue;
      const next = stopById.get(state.nextStopId)?.name ?? "";
      const route = danfo.route;
      if (this.justAlighted?.busId === danfo.id && performance.now() - this.justAlighted.at < 6_000) {
        offer(distance + 1, { key: "✓", label: "You just stepped off this danfo", disabled: true }, () => undefined);
      } else if (state.doorOpen && state.stopId) {
        const full = state.occupied >= state.capacity;
        offer(distance, { key: bind("interact"), label: full ? "Danfo full — wait for the next one" : `Board danfo ${route.routeNumber} · ₦${route.fare}`, detail: `Next: ${next} · ${state.occupied}/${state.capacity} seats`, disabled: full }, () => !full && this.board(danfo.id));
      } else {
        offer(distance + 2, { key: "…", label: "Wait for the danfo to stop", disabled: true }, () => undefined);
      }
    }
    for (const station of BIKE_STATIONS) {
      const distance = Math.hypot(station.point[0] - x, station.point[1] - z);
      if (distance > BIKE_RENTAL.rentRange) continue;
      const stock = this.bikeStock[station.id] ?? BIKE_RENTAL.startingBikes;
      const hire = [...this.vehicles.values()].find(({ state }) => state.mine && state.rentalStartedAt);
      if (hire && Math.hypot(hire.view.x - station.point[0], hire.view.z - station.point[1]) <= BIKE_RENTAL.returnRange) {
        offer(distance - 0.2, { key: bind("interact"), label: "Dock your hired bike", detail: station.name }, () => this.net.send("returnBike"));
      } else if (hire) {
        offer(distance + 0.5, { key: "🚲", label: "You already have a hired bike", detail: "Return it at any station", disabled: true }, () => undefined);
      } else if (stock <= 0) {
        offer(distance, { key: "…", label: `${station.name} · no bikes left`, detail: "Phone → Transport → Bikes shows other stations", disabled: true }, () => undefined);
      } else {
        offer(distance, { key: bind("interact"), label: `Hire a bike · ₦${BIKE_RENTAL.unlockFee} + ₦${BIKE_RENTAL.perMinute}/min`, detail: `₦${BIKE_RENTAL.deposit.toLocaleString("en-NG")} deposit back on return · ${stock} here` }, () => this.rentBike(station.id));
      }
    }
    for (const { view, state } of this.vehicles.values()) {
      const distance = Math.hypot(view.x - x, view.z - z);
      if (distance > VEHICLE_RULES.enterRange) continue;
      const free = view.model.seats - 1 - this.ridersIn(state.id);
      if (state.tow) {
        offer(distance + 1, { key: "🛻", label: state.ownerName, detail: state.mine ? "Recovering your car" : "Recovery truck at work", disabled: true }, () => undefined);
        continue;
      }
      if (state.npc) {
        const ride = this.ride;
        if (ride?.vehicleId === state.id && ride.status === "waiting") {
          offer(distance - 1, { key: bind("interact"), label: "Get in · Naija World Ride", detail: `${ride.driverName} · ${ride.plate} → ${ride.label}` }, () => this.net.send("rideBoard"));
        } else {
          offer(distance + 1, { key: bind("interact"), label: "Ask to share this cab", detail: free > 0 ? "Split the fare with the rider who booked it" : "Full", disabled: free <= 0 }, () => this.net.send("rideAsk", { vehicleId: state.id }));
        }
        continue;
      }
      if (state.mine && !state.driverSessionId) {
        offer(distance - 0.5, { key: bind("interact"), label: `${view.model.body === "bicycle" ? "Ride" : "Drive"} ${view.model.name}`, detail: `${state.plate} · ${state.locked ? "locked" : "unlocked"}` }, () => this.enterVehicle(state.id));
      } else if (state.mine || state.testDriveEndsAt) {
        continue;
      } else if (state.locked) {
        offer(distance + 1, { key: bind("interact"), label: `Ask ${state.ownerName} for a ride`, detail: free > 0 ? `${view.model.name} · locked, they decide` : "No free seat", disabled: free <= 0 }, () => this.net.send("rideAsk", { vehicleId: state.id }));
      } else if (free <= 0) {
        offer(distance + 1, { key: "…", label: `${state.ownerName}'s ${view.model.name}`, detail: view.model.seats < 2 ? "No passenger seat" : "Full", disabled: true }, () => undefined);
      } else if (Math.abs(view.speed) > 1) {
        offer(distance + 1, { key: "…", label: "Wait for it to stop", disabled: true }, () => undefined);
      } else {
        offer(distance, { key: bind("interact"), label: `Ride with ${state.ownerName}`, detail: `${view.model.name} · ${free} seat${free === 1 ? "" : "s"} free` }, () => this.enterVehicle(state.id, "passenger"));
      }
    }
    for (const plot of PLOTS) {
      const state = this.plotStates.find((entry) => entry.id === plot.id);
      const construction = state?.construction ?? null;
      const gate = Math.hypot(plot.gate[0] - x, plot.gate[1] - z);
      if (gate < PLOT_TERMS.range - 3.5) {
        const design = construction ? houseDesign(construction.designId) : null;
        let label = `${plot.name} · lease or buy land`;
        let detail: string | undefined = `₦${PLOT_TERMS.leaseRent.toLocaleString()}/week or ₦${PLOT_TERMS.purchasePrice.toLocaleString()}`;
        if (state?.status === "mine") {
          if (!construction) [label, detail] = [`${plot.name} · choose a house to build`, "Your land"];
          else if (construction.completed) [label, detail] = [`${plot.name} · manage your land`, design?.name];
          else {
            const progress = buildProgress(construction, Date.now());
            [label, detail] = [progress.waitingForPayment ? `${plot.name} · pay builders for the next stage` : `${plot.name} · check the builders`, design?.name];
          }
        } else if (state?.status === "taken") [label, detail] = [`${plot.name} · held by a resident`, undefined];
        const disabled = state?.status === "taken";
        offer(gate, { key: disabled ? "🔒" : bind("interact"), label, detail, disabled }, () => !disabled && this.callbacks.interact({ kind: "plot", plotId: plot.id }));
      }
      if (construction?.completed) {
        const [doorX, doorZ] = houseDoor(plot);
        const distance = Math.hypot(doorX - x, doorZ - z);
        if (distance < INTERACTION_RANGE) {
          if (state?.status === "mine") offer(distance - 0.5, { key: bind("interact"), label: "Enter your house", detail: plot.name }, () => this.enterProperty(builtHomeId(plot.id), "enter"));
          else offer(distance, { key: "🔒", label: "Private house", detail: "Locked", disabled: true }, () => undefined);
        }
      }
    }
    for (const [sessionId, remote] of this.remotes) {
      const sample = remote.samples.at(-1);
      if (!sample || sample.busId || sample.vehicleId || !remote.avatar) continue;
      const { x: rx, z: rz } = remote.avatar.root.position;
      const distance = Math.hypot(rx - x, rz - z);
      if (distance > ROBBERY.range) continue;
      offer(distance + 1.5, { key: bind("interact"), label: `Hold up ${remote.name}`, detail: remote.guards ? "They have armed guards with them" : "Rob them at gunpoint" }, () =>
        this.callbacks.interact({ kind: "holdUp", sessionId, name: remote.name }),
      );
    }
    if (this.repairSite && !this.repairing) {
      const [gx, gz] = this.repairSite.site.at;
      const distance = Math.hypot(gx - x, gz - z);
      if (distance < 5) offer(distance - 6, { key: bind("interact"), label: "Work on the generator", detail: "Find the fault and fix it" }, () => this.callbacks.interact({ kind: "repair" }));
    }
    if (this.gigTarget) {
      const distance = Math.hypot(this.gigTarget.point[0] - x, this.gigTarget.point[1] - z);
      if (distance < GIG_RANGE - 1) offer(distance - 1, { key: bind("interact"), label: `Start job · ${this.gigTarget.title}`, detail: this.gigTarget.place }, () => this.callbacks.interact({ kind: "gig" }));
    }
    for (const place of PLACES) {
      const distance = place.kind === "delivery" ? Math.hypot(place.door[0] - x, place.door[1] - z) : placeDistance(place, x, z);
      if (distance > INTERACTION_RANGE + (place.kind === "rental" || place.kind === "sale" ? 2 : 0)) continue;
      if (place.kind === "delivery") {
        if (this.deliveryTarget && Math.hypot(this.deliveryTarget.point[0] - place.door[0], this.deliveryTarget.point[1] - place.door[1]) < 1) {
          offer(distance, { key: bind("interact"), label: "Deliver parcel", detail: place.name }, () => this.callbacks.interact({ kind: "delivery" }));
        }
        continue;
      }
      const yours = this.listingLabels.get(place.id) === "mine";
      offer(distance, { key: bind("interact"), label: yours ? `Your home · ${place.name}` : `${PLACE_ACTIONS[place.kind]} · ${place.name}`, detail: place.street }, () =>
        place.kind === "starter_home" ? this.enterProperty("starter-home", "enter") : this.callbacks.interact({ kind: "place", place }),
      );
    }
    if (best) {
      const chosen = best as { prompt: Prompt; run: () => void };
      this.prompt = chosen.prompt;
      this.interaction = chosen.run;
    }
  }

  private emitHud(now: number, bus: DanfoView | null, motion: MotionState) {
    const { x, z } = this.controller;
    const district = districtAt(x, z);
    const area = district?.name ?? "Lagos";
    let street = area;
    let named = false;
    if (this.interior) {
      street = this.travelTitle() ?? (this.self?.propertyId ? propertyTitle(this.self.propertyId) : "Indoors");
    } else {
      const road = this.tracker.update(x, z, now);
      if (road) {
        street = road.name ?? (road.kind === "service" ? "Unnamed service road" : "Unnamed road");
        named = Boolean(road.name);
      } else street = `Off-street · ${area}`;
    }
    const average = this.frameTimes.reduce((total, value) => total + value, 0) / Math.max(1, this.frameTimes.length);
    const state = bus?.state;
    this.callbacks.hud({
      network: this.status.state,
      networkReason: this.status.state === "offline" ? this.status.reason : undefined,
      online: this.online,
      street,
      streetNamed: named,
      district: (this.travelView && TRAVEL_DISTRICT[this.travelView.kind]) ?? (district ? `${district.name} · ${district.lga}` : "Lagos"),
      location: bus ? "bus" : this.interior ? "interior" : "street",
      interiorTitle: this.interior ? this.travelTitle() ?? (this.self?.propertyId ? propertyTitle(this.self.propertyId) : null) : null,
      propertyId: this.self?.propertyId ?? null,
      previewOnly: this.self?.previewOnly ?? false,
      prompt: this.prompt,
      secondaryPrompt: this.secondary,
      bus: state
        ? {
            id: state.id,
            routeNumber: bus.route.routeNumber,
            routeName: bus.route.routeName,
            seat: this.self?.seat ?? null,
            nextStop: stopById.get(state.nextStopId)?.name ?? "",
            atStop: state.stopId ? stopById.get(state.stopId)?.name ?? null : null,
            stopRequested: state.stopRequested,
            occupied: state.occupied,
            capacity: state.capacity,
          }
        : null,
      vehicle: this.car && this.driving ? this.vehicleHud(this.car, this.driving) : null,
      vehicleCamera: (this.car && this.driving) || this.passenger ? this.vehicleView : null,
      passenger: (() => {
        const entry = this.passenger ? this.vehicles.get(this.passenger.vehicleId) : undefined;
        return entry ? { owner: entry.state.ownerName, model: entry.view.model.name } : null;
      })(),
      speed: this.car && this.driving ? Math.abs(this.car.speed) : this.controller.speed(),
      mode: this.controller.mode,
      motion,
      fps: Math.round(this.engine.getFps()),
      frameMs: Math.round(average * 10) / 10,
      qualityStep: this.adaptive.level,
      x,
      z,
      yaw: this.controller.yaw,
      cameraYaw: this.cameraYaw,
      waypoint: this.waypoint ? { label: this.waypoint.label, distance: Math.hypot(this.waypoint.point[0] - x, this.waypoint.point[1] - z) } : null,
    });
  }

  private travelTitle() {
    const kind = this.travelView?.kind;
    if (!kind) return null;
    if (kind === "cabin") return this.trip.flight ? `${this.trip.flight.code} · ${this.trip.flight.label}` : "Aircraft cabin";
    if (kind === "airport-los") return "Lagos airport terminal";
    if (kind === "airport-dxb") return "Dubai International · arrivals";
    if (kind === "consulate") return "Dubai Travel Consular Office — Game Roleplay";
    if (kind === "rooftop") return "Skyline Rooftop Lounge";
    if (kind === "dhow") return "Marina dhow cruise";
    if (kind === "safari") return "Desert safari";
    const hotel = this.trip.room ? placeById.get(this.trip.room.hotelId)?.name ?? "Hotel" : "Hotel";
    if (kind === "pool") return `${hotel} · pool deck`;
    return this.self?.previewOnly ? `${hotel} · room preview` : `${hotel} · your room`;
  }

  private vehicleHud(car: CarController, driving: { vehicleId: string; condition: number }) {
    const top = effectiveTopSpeed(car.model, driving.condition);
    const dial = (speed: number) => (car.model.body === "bicycle" ? speed : dialSpeed(speed));
    return {
      id: driving.vehicleId,
      name: car.model.name,
      plate: this.vehicles.get(driving.vehicleId)?.state.plate ?? "",
      kmh: Math.round(dial(Math.abs(car.speed)) * 3.6),
      topKmh: Math.round(dial(top) * 3.6),
      condition: driving.condition,
      limp: driving.condition < VEHICLE_RULES.limpCondition,
      reversing: car.speed < -0.3,
      bicycle: car.model.body === "bicycle",
      testDriveLeft: (() => {
        const ends = this.vehicles.get(driving.vehicleId)?.state.testDriveEndsAt;
        return ends ? Math.max(0, Math.round((ends - Date.now()) / 1000)) : null;
      })(),
      lights: this.lights,
      seats: car.model.seats,
      hire: (() => {
        const started = this.vehicles.get(driving.vehicleId)?.state.rentalStartedAt;
        if (!started) return null;
        const { minutes, usage } = rentalUsage(started, Date.now());
        const { station, distance } = nearestBikeStation(car.x, car.z);
        return { minutes, cost: usage, dockName: distance <= BIKE_RENTAL.returnRange ? station.name : null };
      })(),
    };
  }

  private onSnapshot(snapshot: { players: NetworkPlayer[]; buses: BusState[]; vehicles: WorldVehicle[]; online: number; serverTime?: number }, own: string) {
    const now = performance.now();
    this.online = snapshot.online;
    if (snapshot.serverTime) this.serverOffset += (snapshot.serverTime - Date.now() - this.serverOffset) * 0.2;
    this.syncVehicles(snapshot.vehicles, now);
    const sent = new Set(snapshot.buses.map(({ id }) => id));
    for (const [id, view] of this.buses) {
      if (sent.has(id) || id === this.self?.busId) continue;
      view.dispose();
      this.buses.delete(id);
      this.busTags.get(id)?.remove();
      this.busTags.delete(id);
    }
    for (const state of snapshot.buses) {
      let view = this.buses.get(state.id);
      if (!view && this.danfos) {
        view = this.danfos.create(state.id, getRoute(state.routeId), this.materials, this.atlas, this.avatars);
        this.addCaster(view.meshes);
        this.buses.set(state.id, view);
        const tag = document.createElement("div");
        tag.className = "world-tag bus-tag";
        this.overlay.appendChild(tag);
        this.busTags.set(state.id, tag);
      }
      view?.apply(state, now);
      const tag = this.busTags.get(state.id);
      if (tag) {
        const nextStop = stopById.get(state.nextStopId);
        const next = nextStop ? stopLabel(nextStop.name) : "";
        tag.textContent = `${view?.route.routeNumber ?? ""} danfo · ${state.occupied}/${state.capacity} · ${state.state === "dwelling" ? "Boarding now" : `Next: ${next}`}`;
      }
    }
    const seen = new Set<string>();
    // Only the nearest residents get a full avatar; the rest keep their name tag until they come closer.
    const cap = AVATAR_LIMIT[this.quality] + (this.interior ? 6 : 0);
    const { x: ox, z: oz } = this.controller;
    const near = new Set(
      snapshot.players
        .filter((player) => player.sessionId !== own)
        .sort((a, b) => Math.hypot(a.x - ox, a.z - oz) - Math.hypot(b.x - ox, b.z - oz))
        .slice(0, cap)
        .map((player) => player.sessionId),
    );
    for (const player of snapshot.players) {
      if (player.sessionId === own) {
        this.ownGuards = player.guards;
        continue;
      }
      seen.add(player.sessionId);
      let remote = this.remotes.get(player.sessionId);
      if (!remote) {
        const tag = document.createElement("div");
        tag.className = "world-tag";
        tag.textContent = player.name;
        this.overlay.appendChild(tag);
        remote = { avatar: null, tag, samples: [], speed: 0, lastSeen: now, name: player.name, guards: 0 };
        this.remotes.set(player.sessionId, remote);
      }
      if (near.has(player.sessionId) && !remote.avatar && this.avatars) {
        const avatar = this.avatars.create(`remote-${player.sessionId}`, this.looks.get(player.sessionId) ?? defaultAppearance);
        avatar.setBuild(this.builds.get(player.sessionId) ?? 0);
        avatar.onMeshes = (meshes) => this.addCaster(meshes);
        remote.avatar = avatar;
      } else if (!near.has(player.sessionId) && remote.avatar) {
        remote.avatar.dispose();
        remote.avatar = null;
      }
      remote.lastSeen = now;
      remote.guards = player.guards;
      remote.samples.push({ t: now, x: player.x, z: player.z, yaw: player.yaw, motion: player.motion, busId: player.busId, vehicleId: player.vehicleId, vehicleSeat: player.vehicleSeat });
      if (remote.samples.length > 12) remote.samples.shift();
      remote.tag.classList.toggle("away", !player.connected);
    }
    for (const [sessionId, remote] of this.remotes) {
      if (!seen.has(sessionId)) {
        remote.avatar?.dispose();
        remote.tag.remove();
        this.remotes.delete(sessionId);
      }
    }
  }

  private onLooks(looks: Look[]) {
    for (const { sessionId, appearance, build } of looks) {
      if (sessionId === this.net.sessionId) {
        this.setAppearance(appearance);
        this.build = build;
        this.player?.setBuild(build);
        continue;
      }
      this.looks.set(sessionId, appearance);
      this.builds.set(sessionId, build);
      this.remotes.get(sessionId)?.avatar?.setAppearance(appearance);
      this.remotes.get(sessionId)?.avatar?.setBuild(build);
    }
    if (this.looks.size > 400) {
      for (const sessionId of this.looks.keys()) {
        if (this.looks.size <= 200) break;
        if (!this.remotes.has(sessionId)) this.looks.delete(sessionId);
      }
    }
  }

  currentAppearance() {
    return this.appearance;
  }

  setAppearance(appearance: CharacterAppearance) {
    this.appearance = appearance;
    this.player?.setAppearance(appearance);
  }

  private updateRemotes(now: number, dt: number) {
    const renderTime = now - 120;
    for (const remote of this.remotes.values()) {
      const samples = remote.samples;
      if (!samples.length) continue;
      let a = samples[0]!;
      let b = samples[samples.length - 1]!;
      for (let index = 1; index < samples.length; index += 1) {
        if (samples[index]!.t >= renderTime) {
          a = samples[index - 1]!;
          b = samples[index]!;
          break;
        }
      }
      const span = Math.max(1, b.t - a.t);
      const t = Math.max(0, Math.min(1, (renderTime - a.t) / span));
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      let dyaw = b.yaw - a.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const measured = Math.hypot(b.x - a.x, b.z - a.z) / (span / 1000);
      remote.speed += ((b.busId ? 0 : Math.min(7, measured)) - remote.speed) * Math.min(1, dt * 8);
      const seatView = b.vehicleId && !this.interior ? this.vehicles.get(b.vehicleId)?.view : undefined;
      if (remote.avatar && seatView) {
        const seat = seatView.seat(b.vehicleSeat ?? 0);
        remote.avatar.root.position.set(seat.x, this.world.groundHeight(seat.x, seat.z) + seatView.seatHeight(b.vehicleSeat ?? 0), seat.z);
        remote.avatar.root.rotation.y = seat.yaw;
        remote.avatar.root.setEnabled(true);
        const bike = seatView.model.body === "bicycle";
        const driver = (b.vehicleSeat ?? 0) === 0;
        remote.avatar.update(0, driver && !bike ? "drive" : "sit", dt);
        if (bike && driver) remote.avatar.pedal(seatView.crank);
      } else if (remote.avatar) {
        remote.avatar.root.position.set(x, this.interior ? (this.travelView && b.motion === "sit" ? TRAVEL_SEAT_Y : (this.travelView?.floor(x, z) ?? 0.02)) : this.world.groundHeight(x, z), z);
        remote.avatar.root.rotation.y = a.yaw + dyaw * t;
        remote.avatar.root.setEnabled(!b.busId && !b.vehicleId);
        remote.avatar.update(remote.speed, b.motion, dt);
      }
    }
  }

  private staffPostsNear(x: number, z: number): StaffPost[] {
    const posts: StaffPost[] = [];
    for (const plot of PLOTS) {
      if (Math.hypot(plot.gate[0] - x, plot.gate[1] - z) > 90) continue;
      const state = this.plotStates.find((entry) => entry.id === plot.id);
      if (!state?.construction?.completed || !state.staff?.length) continue;
      const outward = Math.atan2(-plot.inward[0], -plot.inward[1]);
      if (state.staff.includes("gateman")) posts.push({ key: `${plot.id}:gateman`, role: "gateman", point: [plot.gate[0] + plot.along[0] * 2.4 + plot.inward[0] * 0.8, plot.gate[1] + plot.along[1] * 2.4 + plot.inward[1] * 0.8], yaw: outward });
      if (state.staff.includes("guard")) {
        const [dx, dz] = houseDoor(plot);
        posts.push({ key: `${plot.id}:guard`, role: "guard", point: [dx - plot.inward[0] * 1.4 + plot.along[0] * 1.2, dz - plot.inward[1] * 1.4 + plot.along[1] * 1.2], yaw: outward });
      }
    }
    return posts;
  }

  /** Coloured lights inside the home while a house party is on. */
  setHomeParty(on: boolean) {
    if (on && !this.partyLights) this.partyLights = new PartyLights(this.scene);
    if (!on && this.partyLights) {
      this.partyLights.dispose();
      this.partyLights = null;
    }
  }

  /** A rider walks up and hands over a food or pharmacy order. */
  /** Which For Sale / For Rent boards are yours or taken, from the live listings (flats share one board per building). */
  setListings(listings: Array<{ id: string; isMine: boolean; available: boolean }>) {
    const byPlace = new Map<string, { mine: boolean; open: boolean }>();
    for (const listing of listings) {
      const place = propertyPlace(listing.id);
      if (!place || (place.kind !== "sale" && place.kind !== "rental")) continue;
      const entry = byPlace.get(place.id) ?? { mine: false, open: false };
      entry.mine ||= listing.isMine;
      entry.open ||= listing.available && !listing.isMine;
      byPlace.set(place.id, entry);
    }
    this.listingLabels = new Map();
    for (const [placeId, entry] of byPlace) {
      if (entry.mine) this.listingLabels.set(placeId, "mine");
      else if (!entry.open) this.listingLabels.set(placeId, placeById.get(placeId)?.kind === "rental" ? "let" : "sold");
    }
    this.boardsAt = 0;
  }

  /** Delivery orders on the way, waiting, or in hand; collected food is carried until eaten. */
  setParcels(parcels: FoodParcel[]) {
    this.couriers?.set(parcels);
    const carried = parcels.find((parcel) => parcel.status === "collected" && parcel.shop === "food");
    if (!carried && this.heldParcel) this.dropParcel();
    else if (carried && this.heldParcel?.id !== carried.id) this.holdParcel(carried.id);
  }

  /** The rider hands over the bag; food goes into the player's hands. */
  takeParcel(parcel: FoodParcel) {
    this.couriers?.handOver(parcel.id);
    if (parcel.shop === "food") this.holdParcel(parcel.id);
    else this.player?.sip(1.4);
  }

  /** A few bites from the takeaway pack, then it's gone. */
  eatParcel() {
    const held = this.heldParcel;
    if (!held || !this.player) return;
    for (const delay of [0, 1_500, 3_000]) window.setTimeout(() => this.heldParcel === held && this.player?.sip(1.2), delay);
    window.setTimeout(() => this.heldParcel === held && this.dropParcel(), 4_400);
  }

  private holdParcel(id: string) {
    this.dropHeld();
    this.dropParcel();
    if (!this.player) return;
    const node = new TransformNode(`takeaway ${id}`, this.scene);
    const pack = MeshBuilder.CreateBox(`takeaway pack ${id}`, { width: 0.2, height: 0.07, depth: 0.16 }, this.scene);
    pack.material = this.materials.plaster;
    pack.parent = node;
    pack.isPickable = false;
    this.player.hold(node);
    this.heldParcel = { id, node };
  }

  private dropParcel() {
    if (!this.heldParcel) return;
    this.player?.hold(null);
    this.heldParcel.node.dispose();
    this.heldParcel = null;
  }

  /** Dims the screen briefly for a home activity such as watching TV. */
  pauseVeil(icon: string, title: string, caption: string) {
    this.showVeil(icon, title, caption, 2_200);
    if (this.transfer) this.transfer.arrivedAt = performance.now();
  }

  private entranceCandidates(): EntranceCandidate[] {
    const doors: EntranceCandidate[] = PLACES.filter((place) => place.kind !== "delivery").map((place) => ({ key: place.id, point: place.door, name: place.name, approach: place.kerb }));
    for (const plot of PLOTS) {
      const state = this.plotStates.find((entry) => entry.id === plot.id);
      if (state?.status === "mine" && state.construction?.completed) doors.push({ key: plot.id, point: houseDoor(plot), name: "Your house", approach: plot.gate });
    }
    return doors;
  }

  /** Where the robber a victim's guards are chasing off is standing, while the chase lasts. */
  private chaseTarget(victimSessionId: string | null, own: EscortLeader): Vec2 | null {
    const chase = this.guardChases.find((entry) => entry.victimSessionId === victimSessionId);
    if (!chase) return null;
    if (chase.robberSessionId === this.net.sessionId) return [own.x, own.z];
    const robber = this.remotes.get(chase.robberSessionId)?.avatar?.root.position;
    return robber ? [robber.x, robber.z] : null;
  }

  private updateEscorts(dt: number, own: EscortLeader) {
    if (!this.avatars || !this.vehicleFactory) return;
    if (this.guardChases.length) {
      const now = Date.now();
      this.guardChases = this.guardChases.filter((chase) => chase.until > now);
    }
    const wanted = new Map<string, { count: number; leader: EscortLeader }>();
    const inDubai = regionOf(own.x, own.z) === "dubai";
    if (this.ownGuards && !inDubai) wanted.set("self", { count: this.ownGuards, leader: own });
    for (const [sessionId, remote] of this.remotes) {
      const sample = remote.samples.at(-1);
      if (inDubai || !remote.guards || !sample || !remote.avatar) continue;
      const view = sample.vehicleId ? this.vehicles.get(sample.vehicleId)?.view : undefined;
      const pose = view ? { x: view.x, z: view.z, yaw: view.yaw } : { x: remote.avatar.root.position.x, z: remote.avatar.root.position.z, yaw: remote.avatar.root.rotation.y };
      if (Math.hypot(pose.x - own.x, pose.z - own.z) > ESCORT_VISIBLE_RANGE) continue;
      wanted.set(sessionId, { count: remote.guards, leader: { ...pose, driving: Boolean(view), outdoors: !this.interior && !sample.busId } });
    }
    for (const [id, escort] of this.escorts) {
      if (wanted.has(id)) continue;
      escort.dispose();
      this.escorts.delete(id);
    }
    for (const [id, { count, leader }] of wanted) {
      let escort = this.escorts.get(id);
      if (!escort) {
        escort = new Escort(id, this.avatars, this.vehicleFactory, (x, z) => this.world.groundHeight(x, z), (meshes) => this.addCaster(meshes), count);
        this.escorts.set(id, escort);
      }
      if (escort.count !== count) escort.setCount(count);
      escort.chase(this.chaseTarget(id === "self" ? this.net.sessionId : id, own));
      escort.update(dt, leader);
    }
  }

  /** The gate of the player's own finished house opens as they arrive; with guards, one runs ahead to open it. */
  private updateGates(x: number, z: number) {
    if (!this.plotsView) return;
    const escort = this.escorts.get("self");
    let nearest: { plot: (typeof PLOTS)[number]; distance: number } | null = null;
    if (!this.interior) {
      for (const plot of PLOTS) {
        const state = this.plotStates.find((entry) => entry.id === plot.id);
        if (state?.status !== "mine" || !state.construction?.completed) continue;
        const distance = Math.hypot(plot.gate[0] - x, plot.gate[1] - z);
        const gateman = state.staff?.includes("gateman");
        if (distance < (escort || gateman ? GATE_GUARD_RANGE : GATE_OPEN_RANGE) && (!nearest || distance < nearest.distance)) nearest = { plot, distance };
      }
    }
    if (this.gatePlot && this.gatePlot !== nearest?.plot.id) {
      this.plotsView.setGateOpen(this.gatePlot, false);
      escort?.sendToGate(null);
      this.gatePlot = null;
    }
    if (!nearest) return;
    const { plot } = nearest;
    this.gatePlot = plot.id;
    const gateman = this.plotStates.find((entry) => entry.id === plot.id)?.staff?.includes("gateman");
    if (escort && !gateman) {
      escort.sendToGate([plot.gate[0] + plot.along[0] * 3, plot.gate[1] + plot.along[1] * 3]);
      if (escort.atGate()) this.plotsView.setGateOpen(plot.id, true);
    } else {
      this.plotsView.setGateOpen(plot.id, true);
    }
  }

  answerCheckpoint(checkpointId: string, answer: "comply" | "flee") {
    this.flaggedDown = false;
    this.net.send("checkpointAnswer", { checkpointId, answer });
  }

  holdUp(sessionId: string) {
    this.net.send("holdUp", { sessionId });
  }

  answerHoldUp(robberyId: string, answer: "comply" | "run") {
    this.net.send("robberyAnswer", { robberyId, answer });
  }

  private showBubble(message: ChatMessage) {
    const remote = this.remotes.get(message.sessionId);
    if (!remote) return;
    remote.tag.querySelector(".chat-bubble")?.remove();
    const bubble = document.createElement("span");
    bubble.className = "chat-bubble";
    bubble.textContent = message.text;
    remote.tag.prepend(bubble);
    setTimeout(() => bubble.remove(), 7_000);
  }

  sendChat(text: string) {
    return this.net.sendChat(text);
  }

  private project(x: number, y: number, z: number) {
    const width = this.engine.getRenderWidth();
    const height = this.engine.getRenderHeight();
    const transform = this.scene.getTransformMatrix();
    const point = Vector3.Project(new Vector3(x, y, z), Matrix.Identity(), transform, this.camera.viewport.toGlobal(width, height));
    const scale = this.canvas.clientWidth / width;
    return { x: point.x * scale, y: point.y * scale, visible: point.z > 0 && point.z < 1 };
  }

  private updateTags() {
    const { x, z } = this.controller;
    for (const remote of this.remotes.values()) {
      const root = remote.avatar?.root;
      const sample = remote.samples.at(-1);
      if (!sample) continue;
      const px = root?.position.x ?? sample.x;
      const pz = root?.position.z ?? sample.z;
      const distance = Math.hypot(px - x, pz - z);
      const screen = this.project(px, (root?.position.y ?? 0) + 2.1, pz);
      const show = screen.visible && distance < 45 && !sample.busId && !sample.vehicleId;
      remote.tag.style.display = show ? "block" : "none";
      if (show) remote.tag.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -100%)`;
    }
    for (const [id, { view, tag }] of this.vehicles) {
      const distance = Math.hypot(view.x - x, view.z - z);
      const screen = this.project(view.x, view.root.position.y + view.model.height + 0.5, view.z);
      const show = screen.visible && distance < 22 && !this.interior && id !== this.driving?.vehicleId;
      tag.style.display = show ? "block" : "none";
      if (show) tag.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -100%)`;
    }
    for (const [id, tag] of this.busTags) {
      const bus = this.buses.get(id);
      if (!bus) continue;
      const distance = Math.hypot(bus.root.position.x - x, bus.root.position.z - z);
      const screen = this.project(bus.root.position.x, 3.4, bus.root.position.z);
      const show = screen.visible && distance < 70 && !this.interior && this.self?.busId !== id;
      tag.style.display = show ? "block" : "none";
      if (show) tag.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -100%)`;
    }
  }

  private onSelf(self: SelfState) {
    const previous = this.self;
    this.self = self;
    const moved = Boolean(previous && previous.location !== self.location);
    if (moved || self.reason === "teleported" || self.reason === "travelled") this.transitionAt = 0;
    if (this.transfer && !this.transfer.arrivedAt && (moved || self.reason === "teleported" || self.reason === "parked" || self.reason === "travelled")) this.transfer.arrivedAt = performance.now();
    if (self.reason === "alighted" && previous?.busId) this.justAlighted = { busId: previous.busId, at: performance.now() };
    const enteringInterior = self.location !== "street" && (!previous || previous.location !== self.location);
    const leavingInterior = self.location === "street" && this.interior;
    if (leavingInterior) {
      this.interiorToken += 1;
      this.interior?.dispose();
      this.interior = null;
      this.travelView = null;
      this.clearCrew();
      this.staff?.clear();
      this.audio.setCabinHum(0);
      this.club = null;
      this.audio.setClub(null);
      this.clearWaiters();
      this.dropHeld();
    }
    if (enteringInterior) {
      this.dropHeld();
      void this.loadInterior(self);
    }
    const seat = self.vehicleSeat ?? 0;
    if (self.vehicleId && seat === 0 && self.vehicleId !== this.driving?.vehicleId) this.startDriving(self.vehicleId);
    if ((!self.vehicleId || seat > 0) && (this.driving || this.pendingDrive)) this.stopDriving();
    const boarding = Boolean(self.vehicleId && seat > 0 && this.passenger?.vehicleId !== self.vehicleId);
    this.passenger = self.vehicleId && seat > 0 ? { vehicleId: self.vehicleId, seat } : null;
    if (this.rideCar && this.passenger?.vehicleId !== this.rideCar.vehicleId) this.rideCar = null;
    if (boarding && this.passenger) {
      const view = this.vehicles.get(this.passenger.vehicleId)?.view;
      if (view) this.cameraYaw = view.yaw;
      this.cameraPitch = 0.26;
    }
    if (!self.busId) {
      this.controller.teleport(self.x, self.z);
      if (self.reason === "alighted" || self.reason === "exited" || self.reason === "recovered" || self.reason === "parked" || self.reason === "teleported" || !previous) this.snapCamera();
    }
    if (self.reason === "entered" || self.reason === "preview") {
      this.cameraYaw = 0;
      this.cameraPitch = 0.16;
      this.snapCamera();
    }
    this.seatYaw = this.seatFacing(self);
    if (self.location.startsWith("excursion:") && enteringInterior) this.cameraYaw = this.seatYaw;
    this.callbacks.self(self);
  }

  /** Seated travel: cabin seats face forward (+z); dhow benches face the water; the 4×4 faces ahead. */
  private seatFacing(self: SelfState) {
    if (!self.location.startsWith("excursion:")) return 0;
    const kind = self.location.startsWith("excursion:dhow") ? "dhow" : "safari";
    const [ox, oz] = INTERIOR_ORIGIN;
    let best = EXCURSION_SEATS[kind][0]!;
    for (const seat of EXCURSION_SEATS[kind]) {
      if (Math.hypot(ox + seat.at[0] - self.x, oz + seat.at[1] - self.z) < Math.hypot(ox + best.at[0] - self.x, oz + best.at[1] - self.z)) best = seat;
    }
    return best.yaw;
  }

  private onTrip(trip: TripState) {
    const rebuild = Boolean(this.travelView && this.self && trip.room?.hotelId !== this.trip.room?.hotelId);
    const before = this.trip;
    this.trip = trip;
    if (this.travelView && before.ticketId === trip.ticketId) {
      if (!before.immigrationDone && trip.immigrationDone) this.handOver("immigration", "passport", `The officer stamps your passport and hands it back. Welcome to Dubai.${this.ownGuards ? " Your security team stays in Lagos and meets you when you fly back." : ""}`);
      if (!before.bagCollected && trip.bagCollected) this.handOver("baggage", "bag", "The porter lifts your bag off the belt for you. Unpack and change clothes at your hotel wardrobe.");
    }
    this.callbacks.trip(trip);
    if (rebuild && this.self) void this.loadInterior(this.self);
  }

  private spawnCrew() {
    if (!this.avatars) return;
    const [ox, oz] = INTERIOR_ORIGIN;
    for (const [index, z] of [10.4, 3.0].entries()) {
      const avatar = this.avatars.create(`cabin crew ${index}`, { ...appearanceFor(700 + index * 13), outfit: "office-smart", accessory: "none" } satisfies CharacterAppearance);
      avatar.root.position.set(ox, 0.02, oz + z);
      avatar.root.rotation.y = Math.PI;
      this.crew.push({ avatar, z, dir: -1, served: false });
    }
    this.trolley = buildTrolley(this.scene);
  }

  private clearCrew() {
    for (const member of this.crew) member.avatar.dispose();
    this.crew = [];
    this.trolley?.dispose(false, true);
    this.trolley = null;
    this.mealTray?.dispose(false, true);
    this.mealTray = null;
  }

  /** Flight timeline on the shared server clock: window sky, lighting, announcements, crew service, and Dubai preloading. */
  private updateFlight(dt: number) {
    const view = this.travelView;
    const flight = this.trip.flight;
    if (!view || view.kind !== "cabin" || !flight) {
      this.flightShot = null;
      return;
    }
    const now = Date.now() + this.serverOffset;
    const phase = flightPhase(flight.departAt, now);
    const seconds = (now - flight.departAt) / 1_000;
    this.flightShot = view.flightShot(seconds, this.trip.leg === "return" ? "lagos" : "dubai");
    const shot = this.flightShot ? (phase === "takeoff" ? "takeoff" : "landing") : null;
    if (shot !== this.flightShotCaption) {
      this.flightShotCaption = shot;
      const home = this.trip.leg === "return";
      if (shot === "takeoff") this.callbacks.subtitle(`${legRoute(this.trip.leg ?? "outbound").code} rolling down the runway at ${home ? "Dubai International" : "Murtala Muhammed, Lagos"}…`);
      if (shot === "landing") this.callbacks.subtitle(`Final approach into ${home ? "Lagos" : "Dubai"}. Touchdown!`);
    }
    const span = phase === "takeoff" ? TRAVEL.takeoffEnds : phase === "cruise" ? TRAVEL.cruiseEnds - TRAVEL.takeoffEnds : TRAVEL.flightSeconds - TRAVEL.cruiseEnds;
    const start = phase === "takeoff" ? 0 : phase === "cruise" ? TRAVEL.takeoffEnds : TRAVEL.cruiseEnds;
    const destination = this.trip.leg === "return" ? "lagos" : "dubai";
    view.setFlight(phase, Math.max(0, Math.min(1, (seconds - start) / span)), destination);
    if (phase !== this.flightPhaseShown) {
      this.flightPhaseShown = phase;
      const line = CABIN_ANNOUNCEMENTS[phase];
      if (line && this.cabinAudio.announcements) {
        this.audio.chime();
        setTimeout(() => this.audio.announce(line), 900);
      }
      if (line && this.settings.subtitles) this.callbacks.subtitle(line);
    }
    // The crew work the aisle with the trolley during the cruise, serving each row as they pass.
    const [ox, oz] = INTERIOR_ORIGIN;
    const seat = seatPoint(flight.seat);
    for (const member of this.crew) {
      const moving = phase === "cruise";
      if (moving) {
        member.z += member.dir * dt * 0.9;
        if (member.z < -10.5) member.dir = 1;
        if (member.z > 10.8) member.dir = -1;
      }
      member.avatar.root.position.set(ox, 0.02, oz + member.z);
      member.avatar.root.rotation.y = member.dir < 0 ? Math.PI : 0;
      member.avatar.update(moving ? 0.9 : 0, moving ? "walk" : "idle", dt);
      if (member === this.crew[0] && this.trolley) this.trolley.position.set(ox, 0, oz + member.z + member.dir * 0.75);
      if (moving && !member.served && Math.abs(oz + member.z - seat[1]) < 0.4) {
        member.served = true;
        if (!this.crew.some((other) => other !== member && other.served)) {
          const business = flight.cabin === "business";
          if (!this.mealTray) {
            this.mealTray = buildMealTray(this.scene, business);
            this.mealTray.position.set(seat[0], 0.68, seat[1] + (business ? 0.42 : 0.3));
          }
          this.callbacks.subtitle(business ? "Good afternoon. Grilled chicken with jollof, or lamb machboos? And a fresh juice or a mocktail?" : "Something to drink? We have water, juice and soft drinks, and a snack pack.");
          this.callbacks.notice({ tone: "success", text: business ? "Served: hot meal, fresh juice and dates (Business service)." : "Served: a soft drink and a snack pack." });
        }
      }
    }
    // Stream the arrival city while airborne so it is ready on landing.
    const target = placeById.get(destination === "dubai" ? TRAVEL_PLACES.dubaiAirport : TRAVEL_PLACES.lagosAirport);
    if (target && phase !== "boarding") {
      this.world.stream(target.door[0], target.door[1]);
      this.world.pump(10);
      this.preloadPending = this.world.pendingNear();
    }
  }

  /** Per-player cabin sound and announcement switches. */
  getCabinAudio() {
    return { ...this.cabinAudio };
  }

  setCabinAudio(next: CabinAudio) {
    this.cabinAudio = next;
    localStorage.setItem("lagos-cabin-audio", JSON.stringify(next));
    this.audio.setCabinHum(this.travelView?.kind === "cabin" && next.hum ? 1 : 0);
  }

  /** Set by the phone's Go app while it is open. */
  goListener: ((state: FastTravelState) => void) | null = null;

  requestGoState() {
    this.net.send("goState");
  }

  /** Go now: fades out, and the server places the player at the public entrance (or refuses with a reason). */
  fastTravel(target: { placeId: string } | { favourite: Favourite }, label: string, companions: string[] = []) {
    const now = performance.now();
    if (now - this.transitionAt < 3_000) return;
    this.transitionAt = now;
    this.showVeil("📍", `Going to ${label}…`, "Go now", 700);
    this.net.send("fastTravel", { target, with: companions });
  }

  answerAgbero(encounterId: string, choice: AgberoChoice) {
    this.net.send("agberoAnswer", { encounterId, choice });
  }

  /** One tout NPC stands on the kerb by the driver's window for the encounter, then walks off and is removed. */
  private tout: { avatar: Avatar; tag: HTMLDivElement; at: Vec2; leaveAt: number | null } | null = null;

  private showTout(encounter: AgberoEncounter | null) {
    if (!encounter) {
      if (this.tout && this.tout.leaveAt === null) {
        this.tout.leaveAt = performance.now() + 2_500;
        this.tout.tag.textContent = "…";
      }
      return;
    }
    if (this.tout) {
      this.tout.tag.textContent = `"Oga, settle the boys — ₦${encounter.ask}"`;
      return;
    }
    if (!this.avatars) return;
    const [px, pz] = encounter.point;
    const yaw = this.car && this.driving ? this.car.yaw : this.controller.yaw;
    const side: Vec2 = [px + Math.cos(yaw) * 2.2, pz - Math.sin(yaw) * 2.2];
    const at: Vec2 = walkable(side[0], side[1]) ? side : [px - Math.cos(yaw) * 2.2, pz + Math.sin(yaw) * 2.2];
    const avatar = this.avatars.create("agbero", { ...appearanceFor(1_337), outfit: "athleisure", accessory: "cap" });
    avatar.root.position.set(at[0], this.world.groundHeight(at[0], at[1]), at[1]);
    const tag = document.createElement("div");
    tag.className = "world-tag spotter-tag agbero-tag";
    tag.textContent = `"Oga, settle the boys — ₦${encounter.ask}"`;
    this.overlay.appendChild(tag);
    this.tout = { avatar, tag, at, leaveAt: null };
  }

  private updateTout(dt: number, now: number, x: number, z: number) {
    const tout = this.tout;
    if (!tout) return;
    if (this.interior || (tout.leaveAt !== null && now > tout.leaveAt) || Math.hypot(tout.at[0] - x, tout.at[1] - z) > 60) {
      tout.avatar.dispose();
      tout.tag.remove();
      this.tout = null;
      return;
    }
    tout.avatar.root.rotation.y = Math.atan2(x - tout.at[0], z - tout.at[1]);
    tout.avatar.update(0, tout.leaveAt === null ? "wave" : "idle", dt);
    const screen = this.project(tout.at[0], this.world.groundHeight(tout.at[0], tout.at[1]) + 2.1, tout.at[1]);
    tout.tag.style.display = screen.visible ? "block" : "none";
    if (screen.visible) tout.tag.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -100%)`;
  }

  answerRideAsk(sessionId: string, allow: boolean) {
    this.net.send("rideAnswer", { sessionId, allow });
  }

  answerTravel(requestId: string, accept: boolean) {
    this.net.send("travelAnswer", { requestId, accept });
  }

  askToJoin(sessionId: string) {
    this.net.send("joinRequest", { sessionId });
  }

  /** Seated reactions, shown over this player's avatar to everyone in the same cabin or boat. */
  react(emoji: string) {
    this.net.send("react", { emoji });
  }

  namesShown() {
    return !this.overlay.classList.contains("hide-names");
  }

  showNames(show: boolean) {
    this.overlay.classList.toggle("hide-names", !show);
    localStorage.setItem("lagos-name-labels", show ? "1" : "0");
  }

  /** Milliseconds to add to Date.now() to read the room's clock. */
  serverClockOffset() {
    return this.serverOffset;
  }

  /** How many map tiles around the arrival airport still have to load (0 = ready). */
  arrivalPreload() {
    return this.travelView?.kind === "cabin" ? this.preloadPending : 0;
  }

  enterTravel(target: "consulate" | "airport" | "rooftop" | "hotel" | "pool", options: { hotelId?: string; bookingId?: string; previewRoom?: "standard" | "suite" | "luxury" } = {}) {
    if (!this.beginTransition()) return;
    this.net.send("travelEnter", { target, ...options });
  }

  travelCounter(action: "checkin" | "board" | "immigration" | "baggage" | "skip" | "lounge") {
    this.net.send("travelCounter", { action });
  }

  startActivity(activity: ActivityId) {
    this.net.send("activityStart", { activity, idempotencyKey: crypto.randomUUID() });
  }

  rentCar(modelId: string, hours: number) {
    this.net.send("carRent", { modelId, hours, idempotencyKey: crypto.randomUUID() });
  }

  returnCar() {
    this.net.send("carReturn");
  }

  takePhoto(spot: string) {
    this.net.send("photo", { spot });
  }

  backToMarina() {
    if (!this.beginTransition()) return;
    this.net.send("travelTransfer", { to: "marina" });
  }

  tripState() {
    return this.trip;
  }

  /** The person at a counter hands the player what they just paid for (boarding pass, passport, keys...). */
  handOver(deskId: string, prop: StaffProp, caption: string) {
    this.staff.handOver(deskId, prop, caption, [this.controller.x, this.controller.z]);
  }

  /** A waiter carries a paid order from the kitchen or bar to wherever the player is standing or sitting. */
  /** Check-in: the bag packed at home goes onto the belt, and the agent hands back a boarding pass. */
  checkInBag() {
    this.staff.handOver("checkin", "bag", "Your bag from home is tagged and on the belt: your clothes and shoes travel with you.", [this.controller.x, this.controller.z], () => {
      this.handOver("checkin", "pass", "The agent hands you your boarding pass. Next: the gate at the back of the hall.");
    }, true);
  }

  /** Walks to the nearest seat in this venue (lounge sofa, rooftop chair, pool lounger) and sits down. */
  takeSeat() {
    const kind = this.travelView?.kind;
    const seats = kind ? seatsFor(kind) : [];
    if (!seats.length) return false;
    const here: Vec2 = [this.controller.x, this.controller.z];
    const seat = seats.reduce((best, entry) => (Math.hypot(entry.at[0] - here[0], entry.at[1] - here[1]) < Math.hypot(best.at[0] - here[0], best.at[1] - here[1]) ? entry : best));
    const front: Vec2 = [seat.at[0] + Math.sin(seat.yaw) * seat.approach, seat.at[1] + Math.cos(seat.yaw) * seat.approach];
    this.autopilot?.resolve(false);
    this.autopilot = {
      path: [front],
      index: 0,
      sprint: false,
      resolve: (ok) => {
        if (!ok) return;
        this.controller.yaw = seat.yaw;
        this.emote = "sit";
        this.net.send("emote", { emote: "sit" });
        this.sitting = { seat: seat.at, yaw: seat.yaw, y: TRAVEL_SEAT_Y, pose: "sit" };
      },
      lastProgress: performance.now(),
      lastPoint: here,
      deadline: performance.now() + 15_000,
    };
    return true;
  }

  /** Hotel bed: the screen dims for a moment while the player sleeps. */
  sleepVeil(caption = "Energy restored · the room stays yours") {
    this.showVeil("🌙", "Sleeping…", caption, 2_200);
    if (this.transfer) this.transfer.arrivedAt = performance.now();
  }

  /** Car hire: the agent walks out of the office with the keys. */
  deliverKeys(placeId: string, caption: string) {
    const place = placeById.get(placeId);
    if (!place) return this.callbacks.notice({ tone: "success", text: caption });
    this.staff.deliver(place.door, staffLook(91, regionOf(place.door[0], place.door[1]) === "dubai", "agent"), "keys", caption);
  }

  deliverOrder(itemName: string, drink: boolean, itemId?: string) {
    const kind = this.travelView?.kind;
    const from = kind ? serviceOrigin(kind) : this.club ? CLUB_BARTENDER : null;
    const dubai = regionOf(this.controller.x, this.controller.z) === "dubai" || kind === "hotel" || kind === "rooftop" || kind === "airport-dxb";
    const caption = kind === "hotel" ? `Room service: your ${itemName} is here. Enjoy.` : `Your ${itemName} is served. Enjoy.`;
    if (!from) return this.callbacks.notice({ tone: "success", text: caption });
    if (this.club && itemId) {
      const club = this.club;
      const food = !drink;
      const tray = buildServingTray(this.scene, itemId);
      const seed = 300 + Math.floor(Math.random() * 500);
      this.staff.deliver([from[0] + 1.0, from[1]], clubWaitress(seed, club.id === TRAVEL_PLACES.club), tray, `Your ${itemName} is here. ${food ? "Tap Eat for a bite." : "Tap Sip to drink it."}`, () => {
        if (this.club !== club) return;
        this.holdItem(itemId, itemName, food);
      });
      return;
    }
    if (this.club) return this.handOver("bar", "drink", `The bartender hands you your ${itemName}.`);
    this.staff.deliver(from, staffLook(80 + itemName.length, dubai, kind === "hotel" ? "waiter" : "hostess"), drink ? "drink" : "tray", caption);
  }

  private holdItem(itemId: string, name: string, food: boolean) {
    this.dropHeld();
    if (!this.player) return;
    const node = buildMenuItem(this.scene, itemId);
    this.player.hold(node);
    this.heldItem = { node, name, left: food ? 4 : 3, food };
    this.callbacks.holding({ name, left: this.heldItem.left, food });
  }

  /** One sip or bite of what the player is holding; the glass or plate goes once it is finished. */
  sipHeld() {
    const item = this.heldItem;
    if (!item || !this.player) return;
    this.player.sip(item.food ? 1.2 : 1.6);
    item.left -= 1;
    if (item.left > 0) return this.callbacks.holding({ name: item.name, left: item.left, food: item.food });
    window.setTimeout(() => {
      if (this.heldItem !== item) return;
      this.dropHeld();
      this.callbacks.notice({ tone: "success", text: item.food ? `You finished the ${item.name}.` : `You finished your ${item.name}.` });
    }, 1_700);
    this.callbacks.holding({ name: item.name, left: 0, food: item.food });
  }

  dropHeld() {
    if (!this.heldItem) return;
    this.player?.hold(null);
    this.heldItem.node.dispose();
    this.heldItem = null;
    this.callbacks.holding(null);
  }

  /** Walks to the nearest free bar stool, or a sofa at VIP table `table`, and sits down. */
  clubSeat(kind: "stool" | "sofa", table?: number) {
    const view = this.interior && "seats" in this.interior ? this.interior : null;
    const seats = (view?.seats ?? []).filter((seat) => seat.stool === (kind === "stool") && (table === undefined || seat.table === table));
    if (!seats.length || !this.club) return false;
    const here: Vec2 = [this.controller.x, this.controller.z];
    const taken = [...this.remotes.values()].map((remote) => remote.avatar?.root.position).filter((at): at is NonNullable<typeof at> => Boolean(at));
    const free = seats.filter((seat) => !taken.some((at) => Math.hypot(at.x - seat.at[0], at.z - seat.at[1]) < 0.35));
    const pool = free.length ? free : seats;
    const seat = pool.reduce((best, entry) => (Math.hypot(entry.at[0] - here[0], entry.at[1] - here[1]) < Math.hypot(best.at[0] - here[0], best.at[1] - here[1]) ? entry : best));
    const front: Vec2 = kind === "stool" ? [seat.at[0] + 0.55, seat.at[1]] : (CLUB_TABLES.find((entry) => entry.no === seat.table)?.spot ?? seat.at);
    this.autopilot?.resolve(false);
    this.autopilot = {
      path: [front],
      index: 0,
      sprint: false,
      resolve: (ok) => {
        if (!ok || !this.club) return;
        this.controller.yaw = seat.yaw;
        this.emote = "sit";
        this.net.send("emote", { emote: "sit" });
        this.sitting = { seat: seat.at, yaw: seat.yaw, y: seat.y, pose: "sit", stool: seat.stool };
      },
      lastProgress: performance.now(),
      lastPoint: here,
      deadline: performance.now() + 15_000,
    };
    return true;
  }

  /** Walks to the nearest free sofa seat, dining chair or bed at home and sits or lies down; `onSeated` runs once there. */
  homeSeat(kind: HomeRest, onSeated?: () => void) {
    const view = this.interior && "seats" in this.interior ? this.interior : null;
    const seats = (view?.seats ?? []).filter((seat) => seat.rest === kind);
    if (!seats.length || this.club || this.travelView) return false;
    const here: Vec2 = [this.controller.x, this.controller.z];
    const taken = [...this.remotes.values()].map((remote) => remote.avatar?.root.position).filter((at): at is NonNullable<typeof at> => Boolean(at));
    const free = seats.filter((seat) => !taken.some((at) => Math.hypot(at.x - seat.at[0], at.z - seat.at[1]) < 0.35));
    const pool = free.length ? free : seats;
    const seat = pool.reduce((best, entry) => (Math.hypot(entry.at[0] - here[0], entry.at[1] - here[1]) < Math.hypot(best.at[0] - here[0], best.at[1] - here[1]) ? entry : best));
    // Walk to just in front of the seat, or past the foot of the bed; the collider keeps the player off the furniture.
    const front: Vec2 = [seat.at[0] + Math.sin(seat.yaw) * 0.6, seat.at[1] + Math.cos(seat.yaw) * 0.6];
    this.autopilot?.resolve(false);
    this.autopilot = {
      path: [front],
      index: 0,
      sprint: false,
      resolve: (ok) => {
        if (!this.interior) return;
        if (!ok && Math.hypot(this.controller.x - front[0], this.controller.z - front[1]) > 1.6) return;
        this.controller.yaw = seat.yaw;
        this.emote = "sit";
        this.net.send("emote", { emote: "sit" });
        this.sitting = { seat: seat.at, yaw: seat.yaw, y: seat.y, pose: "sit", rest: kind };
        onSeated?.();
      },
      lastProgress: performance.now(),
      lastPoint: here,
      deadline: performance.now() + 15_000,
    };
    return true;
  }

  /** On a bar stool: stand up on it and dance, or sit back down. */
  stoolDance(up: boolean) {
    const chair = this.sitting;
    if (!chair?.stool) return;
    const pose = up ? "dance" : "sit";
    this.emote = pose;
    this.net.send("emote", { emote: pose });
    this.sitting = { ...chair, pose };
  }

  private async loadInterior(self: SelfState) {
    const token = ++this.interiorToken;
    const travel = travelInteriorOf(self.location);
    if (travel) {
      this.interior?.dispose();
      this.clearCrew();
      const view = buildTravelInterior(this.scene, this.materials, this.atlas, travel, this.trip, this.props);
      this.interior = view;
      this.travelView = view;
      this.club = null;
      this.audio.setClub(null);
      this.flightPhaseShown = null;
      if (travel === "cabin") this.spawnCrew();
      this.staff.setDesks(deskStaffFor(travel));
      this.audio.setCabinHum(travel === "cabin" && this.cabinAudio.hum ? 1 : 0);
      return;
    }
    this.travelView = null;
    this.audio.setCabinHum(0);
    const club = self.location.startsWith("club:") && self.propertyId ? CLUBS[self.propertyId] : undefined;
    const kind: InteriorKind = club ? "club" : self.location.startsWith("starter:") ? "starter" : self.previewOnly ? "preview" : "home";
    const title = self.propertyId ? propertyTitle(self.propertyId) : "Home";
    let placements: Placement[] = [];
    let layout = homeLayout(self.propertyId);
    if (kind === "home" && self.propertyId) {
      const response = await fetch(`${apiUrl}/api/properties/${self.propertyId}/interior`, { credentials: "include", headers: authHeaders() }).catch(() => null);
      if (response?.ok) {
        const body = (await response.json()) as { furniture: Placement[]; tier?: HomeTier };
        placements = body.furniture;
        if (body.tier) layout = HOME_LAYOUTS[body.tier];
      } else this.callbacks.notice({ tone: "error", text: "Could not load your furniture — showing an empty room." });
    }
    if (this.props) await this.props.ensure(interiorModels(kind, layout, placements));
    if (token !== this.interiorToken || this.self?.location !== self.location) return;
    this.interior?.dispose();
    this.interior = buildInterior(this.scene, this.materials, this.atlas, kind, title, placements, club, { layout, props: this.props });
    this.interior.setCutaway(this.planShare !== null);
    this.staff.setDesks(club ? [{ id: "bar", at: CLUB_BARTENDER, yaw: Math.PI / 2, look: staffLook(70 + club.bpm, regionOf(self.x, self.z) === "dubai" || club.id === TRAVEL_PLACES.club, "hostess") }] : []);
    this.club = club ?? null;
    this.audio.setClub(this.club);
  }

  /**
   * Latest VIP tables for the club the player is in. Bottles already on a table appear at once; newly ordered ones
   * are carried over from the bar by a waiter first.
   */
  setClubTables(tables: ClubTable[]) {
    if (!this.interior || !this.club) return;
    for (const table of tables) {
      const ids = table.bottles.map((bottle) => bottle.id);
      const known = this.tableBottles.get(table.no);
      this.tableBottles.set(table.no, ids);
      const fresh = known ? ids.filter((id) => !known.includes(id)) : [];
      const spec = CLUB_TABLES.find((entry) => entry.no === table.no)!;
      if (!fresh.length || !this.avatars) {
        if (!this.waiters.some((waiter) => waiter.table === table.no)) this.interior.setTableBottles(table.no, table.bottles);
        continue;
      }
      // Bottle girls carry the order high on a tray, sparklers lit, from the bar to the booth.
      const dubai = this.club.id === TRAVEL_PLACES.club;
      const avatar = this.avatars.create(`hostess ${table.no} ${fresh[0]}`, { ...staffLook(900 + table.no + fresh.length, dubai, "hostess"), outfit: dubai ? "office-skirt" : "ankara-dress" } satisfies CharacterAppearance);
      const [barX, barZ] = CLUB_LAYOUT.bar;
      const [tx, tz] = spec.table;
      const path: Vec2[] = [[barX + 0.4, barZ], [barX + 0.6, tz], [tx - 0.55, tz]];
      avatar.root.position.set(path[0]![0], 0.02, path[0]![1]);
      const prop = this.staff.buildProp("bottle");
      prop.parent = avatar.root;
      prop.position.set(0.05, 1.55, 0.3);
      const sparkler = fresh.some((id) => bottleById.get(table.bottles.find((bottle) => bottle.id === id)?.itemId ?? "")?.sparkler);
      this.waiters.push({ avatar, path, t: 0, table: table.no, bottles: table.bottles, prop, sparkler });
    }
  }

  private updateWaiters(dt: number) {
    if (!this.waiters.length) return;
    const speed = 1.4;
    for (const waiter of [...this.waiters]) {
      waiter.t += dt * speed;
      let remaining = waiter.t;
      let done = true;
      for (let index = 0; index < waiter.path.length - 1; index += 1) {
        const a = waiter.path[index]!;
        const b = waiter.path[index + 1]!;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (remaining <= length) {
          const f = remaining / length;
          waiter.avatar.root.position.set(a[0] + (b[0] - a[0]) * f, 0.02, a[1] + (b[1] - a[1]) * f);
          waiter.avatar.root.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
          waiter.avatar.update(speed, "walk", dt);
          done = false;
          break;
        }
        remaining -= length;
      }
      const spark = waiter.prop.getChildMeshes(false).find((child) => child.name.endsWith("spark"));
      spark?.setEnabled(waiter.sparkler);
      if (spark) spark.scaling.setAll(0.6 + Math.random() * 0.9);
      if (!done) continue;
      this.interior?.setTableBottles(waiter.table, waiter.bottles);
      if (waiter.t > 99) continue;
      waiter.prop.dispose();
      if (waiter.sparkler && this.interior && "celebrate" in this.interior) this.interior.celebrate(waiter.table);
      this.callbacks.notice({ tone: "success", text: `Bottle service: your order arrives at VIP ${waiter.table}${waiter.sparkler ? " with sparklers, and the DJ lights the club up for you" : ""}.` });
      // Stand at the table for a moment after serving, then leave.
      waiter.t = 100;
      waiter.avatar.update(0, "idle", dt);
      setTimeout(() => {
        waiter.avatar.dispose();
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
      }, 2_500);
    }
  }

  private clearWaiters() {
    for (const waiter of this.waiters) waiter.avatar.dispose();
    this.waiters = [];
    this.tableBottles.clear();
  }

  /** Pauses the synthesised club beat while the DJ's real set is playing. */
  setClubBeat(on: boolean) {
    this.audio.setClub(on ? this.club : null);
  }

  /** Home designer view: the room from straight above with the ceiling lifted off, drawn in the top `share` of the screen. */
  setPlanView(share: number | null) {
    this.planShare = share;
    this.camera.viewport = share ? new Viewport(0, 1 - share, 1, share) : new Viewport(0, 0, 1, 1);
    if (this.interior && "setCutaway" in this.interior) this.interior.setCutaway(share !== null);
    if (!share) this.snapCamera();
  }

  /** Rebuilds the room in place (the old one stays up until the new one is ready, so there is no flash of street). */
  async refreshInterior() {
    if (this.self && this.self.location !== "street") await this.loadInterior(this.self);
  }

  private updateWaypoint(now: number) {
    const target = this.waypoint;
    if (target && this.interior && this.waypointDoor && Math.hypot(this.lastStreet[0] - target.point[0], this.lastStreet[1] - target.point[1]) < 25) {
      this.setWaypoint(null);
      this.callbacks.arrived(target.label);
    }
    if (!this.interior) this.lastStreet = [this.controller.x, this.controller.z];
    if (!target || this.interior || this.riding()) {
      this.beacon?.setEnabled(false);
      this.routeMesh?.setEnabled(false);
      return;
    }
    if (!this.beacon) {
      this.beacon = MeshBuilder.CreateCylinder("waypoint beacon", { height: 40, diameterTop: 0.7, diameterBottom: 1.1, tessellation: 16, cap: 0 }, this.scene);
      const material = new PBRMaterial("beacon", this.scene);
      material.unlit = true;
      material.albedoColor = Color3.FromHexString("#ffcf3a");
      material.alpha = 0.32;
      material.backFaceCulling = false;
      this.beacon.material = material;
      this.beacon.isPickable = false;
    }
    const { x, z } = this.controller;
    const door = this.waypointDoor;
    const goal = door ? (this.car ? (door.approach ?? door.point) : door.point) : target.point;
    const approach = door && !this.car ? door.approach : undefined;
    const distance = Math.hypot(goal[0] - x, goal[1] - z);
    if (this.waypointDoor && this.car && distance < 30 && this.parkNoticeFor !== target.label) {
      this.parkNoticeFor = target.label;
      this.caption(`You're at ${target.label} — park and walk to the glowing blue ENTRANCE`);
    }
    if (this.waypointDoor ? !this.car && distance < 3.5 : distance < (this.car ? 18 : 9)) {
      this.setWaypoint(null);
      this.beacon.setEnabled(false);
      this.routeMesh?.setEnabled(false);
      this.callbacks.arrived(target.label);
      return;
    }
    this.beacon.setEnabled(true);
    this.beacon.position.set(goal[0], 20, goal[1]);
    const moved = Math.hypot(x - this.lastRoute.x, z - this.lastRoute.z);
    if (this.routePlan) {
      this.guidance = guide(this.routePlan, [x, z]);
      if (this.guidance && this.guidance.offRoute > 18 && now - this.lastRoute.at > 600 && this.routePlan.reachable) {
        this.lastRoute.at = 0;
        if (now - this.reroutedAt > 8000) this.caption("Missed the turn — rerouting");
        this.reroutedAt = now;
      }
    }
    if (now - this.lastRoute.at > 2500 || moved > 12 || !this.routeMesh) {
      this.lastRoute = { at: now, x, z };
      this.routePlan = this.navigator.plan([x, z], goal, approach);
      this.routePoints = this.routePlan.points;
      this.guidance = guide(this.routePlan, [x, z]);
      this.routeMesh?.dispose();
      const batch = new MeshBuilderBatch("route");
      const points = this.routePoints.filter((point, index, all) => index === 0 || Math.hypot(point[0] - all[index - 1]![0], point[1] - all[index - 1]![1]) > 0.3);
      const half = this.car ? 0.7 : 0.35;
      if (points.length >= 2) {
        batch.ribbon(points, -half, half, 0.22, 1, [0.18, 0.83, 1]);
        routeChevrons(batch, points, half, this.car ? 9 : 5);
      }
      if (!this.routeMaterial) {
        this.routeMaterial = new PBRMaterial("route glow", this.scene);
        this.routeMaterial.unlit = true;
        this.routeMaterial.albedoColor = Color3.White();
        this.routeMaterial.alpha = 0.7;
        this.routeMaterial.zOffset = -6;
      }
      this.routeMesh = batch.build(this.scene, this.routeMaterial);
    }
    this.routeMesh?.setEnabled(true);
  }

  // ---- Public API used by the React HUD -------------------------------------------------

  routePreview() {
    return this.routePoints;
  }

  pose() {
    return { x: this.controller.x, z: this.controller.z, yaw: this.controller.yaw, cameraYaw: this.cameraYaw, indoors: Boolean(this.interior) };
  }

  busPositions() {
    return [...this.buses.values()].map((bus) => ({ id: bus.id, x: bus.root.position.x, z: bus.root.position.z, yaw: bus.yaw, state: bus.state?.state ?? "driving" }));
  }

  /** Other online residents in this world; passengers on a danfo are left to the bus marker. */
  residentPositions() {
    return [...this.remotes.values()].flatMap((remote) => {
      const sample = remote.samples[remote.samples.length - 1];
      if (!sample || sample.busId) return [];
      return [{ name: remote.name, x: sample.x, z: sample.z, driving: Boolean(sample.vehicleId) }];
    });
  }

  setInputEnabled(enabled: boolean) {
    this.input?.setEnabled(enabled);
  }

  /** Turn-by-turn state for the HUD while a destination is set. */
  navigation() {
    const target = this.waypoint;
    const plan = this.routePlan;
    if (!target || !plan || this.interior) return null;
    return {
      label: target.label,
      reachable: plan.reachable,
      gap: Math.round(plan.gap),
      guidance: this.guidance,
      rerouting: performance.now() - this.reroutedAt < 2500,
    };
  }

  currentWaypoint() {
    return this.waypoint;
  }

  /** Road distance and route between two points, for fares and ETAs. */
  planRoute(from: Vec2, to: Vec2) {
    return this.navigator.plan(from, to);
  }

  /** Outdoor table sets beside the entrance path of every restaurant, buka and café. */
  private placeStreetProps(props: PropLibrary) {
    for (const place of PLACES) {
      if (place.kind !== "food" && place.kind !== "restaurant" && place.kind !== "cafe") continue;
      const dx = place.kerb[0] - place.door[0];
      const dz = place.kerb[1] - place.door[1];
      const length = Math.hypot(dx, dz) || 1;
      const [fx, fz] = [dx / length, dz / length];
      const out = Math.min(4, Math.max(2.2, length * 0.35));
      for (const side of [-1, 1]) {
        const x = place.door[0] + fx * out - fz * side * 3.2;
        const z = place.door[1] + fz * out + fx * side * 3.2;
        props.place("restaurant-table", x, z, Math.atan2(fx, fz), this.streetProps, this.world.groundHeight(x, z));
      }
    }
    const stations = gymStations();
    void props.ensure(stations.map((station) => station.prop)).then(() => {
      if (this.disposed) return;
      for (const station of stations) {
        const [px, pz] = station.propAt;
        props.place(station.prop, px, pz, station.propYaw, this.streetProps, this.world.groundHeight(px, pz));
      }
    });
  }

  /** Puts the player on the machine for a gym set; false when they are driving, riding or indoors. */
  startWorkout(exercise: ExerciseId) {
    const station = gymStations().find((entry) => entry.exercise === exercise);
    if (!station || this.interior || this.driving || this.passenger || this.riding()) return false;
    this.emote = null;
    this.sitting = null;
    this.controller.teleport(station.at[0], station.at[1]);
    this.workout = { station, time: 0 };
    return true;
  }

  stopWorkout() {
    this.workout = null;
  }

  isWorkingOut() {
    return this.workout !== null;
  }

  /** Starts the free Dubai Marina walking tour with a guide beside the player; only on the street in Dubai. */
  startTour() {
    if (!this.avatars || this.interior || this.playerRegion() !== "dubai") return false;
    this.endTour();
    this.tour = new TourGuide(
      this.avatars,
      tourStops(),
      [this.controller.x, this.controller.z],
      (x, z) => this.world.groundHeight(x, z),
      (from, to) => this.navigator.plan(from, to).points,
      (text) => this.callbacks.notice({ tone: "info", text }),
    );
    this.callbacks.notice({ tone: "info", text: "🧭 Aisha is your guide. Follow her around the Marina; she waits if you fall behind." });
    return true;
  }

  endTour() {
    this.tour?.dispose();
    this.tour = null;
  }

  tourState() {
    const tour = this.tour;
    const stop = tour?.stop;
    if (!tour) return null;
    const [gx, gz] = tour.position;
    return { stop: stop?.name ?? null, index: tour.progress.index, total: tour.progress.total, guideMetres: Math.round(Math.hypot(gx - this.controller.x, gz - this.controller.z)) };
  }

  /** Which travel interior the player is standing in (terminal, hotel, deck…), or null on the street and at home. */
  travelKind() {
    return this.self && this.interior ? travelInteriorOf(this.self.location) : null;
  }

  setIndoorGuide(guide: { spot: string; label: string } | null) {
    this.indoorGuide = guide;
  }

  /** A glowing strip on the floor from the player to the next desk; hidden once they are standing at it. */
  private updateGuideLine(from: Vec2, to: Vec2 | null) {
    const length = to ? Math.hypot(to[0] - from[0], to[1] - from[1]) : 0;
    if (!to || length < 2.2) {
      this.guideLine?.setEnabled(false);
      return;
    }
    if (!this.guideLine) {
      this.guideLine = MeshBuilder.CreateBox("indoor guide line", { width: 0.32, height: 0.02, depth: 1 }, this.scene);
      const material = new PBRMaterial("indoor guide", this.scene);
      material.unlit = true;
      material.albedoColor = Color3.FromHexString("#3fd8ff");
      material.alpha = 0.55;
      this.guideLine.material = material;
      this.guideLine.isPickable = false;
    }
    const run = length - 1.4;
    const dx = (to[0] - from[0]) / length;
    const dz = (to[1] - from[1]) / length;
    this.guideLine.setEnabled(true);
    this.guideLine.scaling.z = run;
    this.guideLine.rotation.y = Math.atan2(dx, dz);
    this.guideLine.position.set(from[0] + dx * (0.3 + run / 2), 0.035, from[1] + dz * (0.3 + run / 2));
  }

  setWaypoint(target: { point: Vec2; label: string } | null) {
    const same = target && this.waypoint && target.point[0] === this.waypoint.point[0] && target.point[1] === this.waypoint.point[1];
    this.waypoint = target;
    if (!same) {
      this.lastRoute.at = 0;
      this.parkNoticeFor = null;
      const near = (point: Vec2) => target && Math.hypot(point[0] - target.point[0], point[1] - target.point[1]) < 2;
      const kerbPlace = target ? PLACES.find((place) => place.kind !== "delivery" && place.buildingId !== null && near(place.kerb)) : undefined;
      this.waypointDoor = target
        ? (this.entranceCandidates().find((door) => near(door.point)) ?? (kerbPlace ? { key: kerbPlace.id, point: kerbPlace.door, name: kerbPlace.name, approach: kerbPlace.kerb } : null))
        : null;
      if (this.waypointDoor && target) this.waypointDoor = { ...this.waypointDoor, name: target.label };
    }
    if (!target) {
      this.routePlan = null;
      this.guidance = null;
    }
  }

  /** The door of the player's gig while they are travelling to it; `null` once the work has started or the gig ended. */
  setGigTarget(target: { point: Vec2; title: string; place: string } | null) {
    this.gigTarget = target;
  }

  /** Shows the broken generator for an active repair gig at this place; null removes it. */
  setRepairSite(placeId: string | null, running = false) {
    if (this.repairSite && this.repairSite.placeId !== placeId) {
      this.repairSite.site.dispose();
      this.repairSite = null;
      this.repairing = null;
    }
    if (placeId && !this.repairSite) {
      this.repairSite = { placeId, site: new RepairSite(this.scene, this.props, getPlace(placeId), (x, z) => this.world.groundHeight(x, z)) };
    }
    this.repairSite?.site.setRunning(running);
  }

  /** Puts the player at the generator working on it for `seconds`; false when they are not beside it on foot. */
  repairWork(seconds: number) {
    const site = this.repairSite?.site;
    if (!site || this.interior || this.driving || this.passenger || this.riding()) return false;
    if (Math.hypot(site.at[0] - this.controller.x, site.at[1] - this.controller.z) > 5) return false;
    this.emote = null;
    this.sitting = null;
    this.workout = null;
    this.controller.teleport(...site.stand);
    this.cameraYaw = site.faceYaw - 0.8;
    this.repairing = { until: performance.now() + seconds * 1_000, time: 0 };
    return true;
  }

  setDeliveryTarget(target: { point: Vec2; label: string } | null) {
    this.deliveryTarget = target;
    this.parcel?.setEnabled(Boolean(target));
    this.net.send("carrying", Boolean(target));
  }

  /** The player's own car for the car spotters: driven (not a test drive or hire bike), or parked close by while on foot. */
  private spottedCar(x: number, z: number): SpottedCar | null {
    if (this.driving && this.car) {
      const entry = this.vehicles.get(this.driving.vehicleId);
      if (!entry || !entry.state.mine || entry.state.testDriveEndsAt || entry.state.rentalStartedAt) return null;
      return { id: entry.state.id, x: this.car.x, z: this.car.z, speed: this.car.speed, modelId: entry.state.modelId, colour: entry.state.colour, condition: this.driving.condition };
    }
    if (this.passenger || this.self?.busId) return null;
    for (const { state, view } of this.vehicles.values()) {
      if (!state.mine || state.driverSessionId || state.testDriveEndsAt || state.rentalStartedAt || Math.hypot(view.x - x, view.z - z) > 15) continue;
      return { id: state.id, x: view.x, z: view.z, speed: 0, modelId: state.modelId, colour: state.colour, condition: null };
    }
    return null;
  }

  setSettings(settings: PlayerSettings) {
    this.settings = settings;
    if (this.spotters) {
      this.spotters.enabled = settings.carSpotters;
      if (!settings.carSpotters) this.spotters.clear();
    }
    this.audio.apply(settings);
    if (!settings.autoGraphics && this.adaptive.level !== 0) {
      this.adaptive.reset();
      this.applyQualityStep(0);
    }
  }

  private caption(text: string) {
    if (this.settings.subtitles) this.callbacks.subtitle(text, "sound");
  }

  private applyQualityStep(level: number) {
    if (!this.engine || !this.scene) return;
    const step = qualityStep(level);
    this.engine.setHardwareScalingLevel(Math.max(this.baseScaling, Math.min(MAX_AUTO_SCALING, this.baseScaling * step.scaling)));
    if (this.shadows) this.sun.shadowEnabled = step.shadows;
    this.camera.maxZ = step.viewDistance;
    this.scene.fogDensity = step.fogDensity;
  }

  setBindings(bindings: Bindings) {
    this.bindings = bindings;
    if (this.input) this.input.bindings = bindings;
  }

  setTouchDrive(pedals: { throttle: number; brake: number; steer: number } | null) {
    if (this.input) this.input.touchDrive = pedals;
  }

  honk() {
    if (!this.driving) return;
    this.audio.horn(this.car?.model.body === "bicycle" ? 0.35 : 1);
    this.net.send("vehicleSignal", { horn: true });
  }

  toggleLights() {
    if (!this.driving) return;
    this.lights = !this.lights;
    this.vehicles.get(this.driving.vehicleId)?.view.setLights(this.lights);
    this.net.send("vehicleSignal", { lights: this.lights });
  }

  private ridersIn(vehicleId: string) {
    let count = this.passenger?.vehicleId === vehicleId ? 1 : 0;
    for (const remote of this.remotes.values()) {
      const last = remote.samples.at(-1);
      if (last?.vehicleId === vehicleId && (last.vehicleSeat ?? 0) > 0) count += 1;
    }
    return count;
  }

  /** Another driver's horn; quieter with distance. */
  hornAt(x: number, z: number) {
    const distance = Math.hypot(x - this.controller.x, z - this.controller.z);
    if (distance < 80) this.audio.horn(Math.max(0.1, 1 - distance / 80));
  }

  setTouchMove(x: number, z: number, sprint: boolean) {
    if (!this.input) return;
    this.input.touchMove = [x, z];
    this.input.touchSprint = sprint;
  }

  touchLook(dx: number, dy: number) {
    if (!this.input) return;
    this.input.lookDX += dx;
    this.input.lookDY += dy;
  }

  triggerInteract() {
    const bus = this.riding();
    if (bus) this.alight();
    else this.interaction?.();
  }

  board(busId: string) {
    this.net.send("board", { busId });
  }

  alight() {
    this.net.send("alight");
  }

  requestStop() {
    this.net.send("requestStop");
  }

  setPlots(states: PlotState[]) {
    this.plotStates = states;
    syncPlotFootprints(states.flatMap((state) => (state.construction ? [{ plotId: state.id, designId: state.construction.designId, stagesPaid: state.construction.stagesPaid }] : [])));
    this.plotsView?.update(states, Date.now());
  }

  enterProperty(propertyId: string, mode: "enter" | "preview") {
    if (!this.beginTransition()) return;
    this.net.send("enterProperty", { propertyId, mode });
  }

  exitProperty() {
    if (!this.beginTransition()) return;
    this.net.send("exitProperty");
  }

  /** One location change at a time: ignores repeat taps and hides the swap behind a short fade. */
  private beginTransition() {
    const now = performance.now();
    if (now - this.transitionAt < 3_000) return false;
    this.transitionAt = now;
    if (!this.transfer) this.showVeil("fade", "", "", 250);
    return true;
  }

  enterVehicle(vehicleId: string, seat?: "driver" | "passenger") {
    this.net.send("enterVehicle", seat ? { vehicleId, seat } : { vehicleId });
  }

  rentBike(stationId: string) {
    this.net.send("rentBike", { stationId, idempotencyKey: crypto.randomUUID() });
  }

  returnBike() {
    this.net.send("returnBike");
  }

  /** Stations with live stock, and the player's current hire if any. */
  bikeStatus() {
    const { x, z } = this.controller;
    const hire = [...this.vehicles.values()].find(({ state }) => state.mine && state.rentalStartedAt);
    return {
      stations: BIKE_STATIONS.map((station) => ({ ...station, stock: this.bikeStock[station.id] ?? BIKE_RENTAL.startingBikes, distance: Math.hypot(station.point[0] - x, station.point[1] - z) })),
      hire: hire
        ? { vehicleId: hire.state.id, startedAt: hire.state.rentalStartedAt!, point: [hire.view.x, hire.view.z] as Vec2, riding: this.driving?.vehicleId === hire.state.id, ...rentalUsage(hire.state.rentalStartedAt!, Date.now()) }
        : null,
    };
  }

  /** Road pickup near the player, the drop-off road point near `destination`, and the road route between them. */
  rideQuote(destination: Vec2) {
    const { x, z } = this.controller;
    const pickup = this.navigator.snap([x, z]);
    const dropoff = this.navigator.snap(destination);
    const plan = this.navigator.plan(pickup.point, dropoff.point);
    return { pickup, dropoff, plan, indoors: Boolean(this.interior), aboard: Boolean(this.self?.busId || this.driving || this.passenger) };
  }

  /** Fare, trip length and any reason a ride to `destination` cannot be booked from here. */
  rideOffer(destination: Vec2, label: string) {
    const result = this.rideQuote(destination);
    const straight = Math.hypot(result.dropoff.point[0] - result.pickup.point[0], result.dropoff.point[1] - result.pickup.point[1]);
    let problem: string | null = null;
    if (result.indoors) problem = "You're indoors. Step out to the street first: the driver arrives about 10 seconds after you book from the kerb, and the timer only starts then.";
    else if (result.aboard) problem = "Get out of your current vehicle before booking.";
    else if (result.pickup.distance > RIDE.pickupRange) problem = `You are ${Math.round(result.pickup.distance)} m from the nearest road. Walk to a street so the driver can reach you.`;
    else if (!result.plan.reachable) problem = `No road connects here with ${label}. Try the danfo, or walk.`;
    else if (result.dropoff.distance > 400) problem = `${label} is ${Math.round(result.dropoff.distance)} m from any road, so a car cannot get there.`;
    else if (straight < RIDE.minMetres) problem = `${label} is a short walk away (${Math.round(straight)} m).`;
    else if (straight > RIDE.maxMetres) problem = `${label} is outside the service area.`;
    const metres = Math.min(straight * RIDE.maxRoadFactor, Math.max(straight, result.plan.metres));
    return { ...result, problem, metres, fare: rideFare(metres), tripSeconds: metres / (RIDE.driverSpeed * 0.75), walkAfter: result.dropoff.distance };
  }

  requestTow(vehicleId: string, destination: TowDestination) {
    this.net.send("towRequest", { vehicleId, destination, idempotencyKey: crypto.randomUUID() });
  }

  cancelTow(towId: string) {
    this.net.send("towCancel", { towId });
  }

  bookRide(destination: Vec2, label: string, express = false) {
    const quote = this.rideQuote(destination);
    // The driver waits facing the way the trip starts, so it pulls away without a U-turn across the pavement.
    const [sx, sz] = quote.pickup.point;
    const ahead = quote.plan.points.find((point) => Math.hypot(point[0] - sx, point[1] - sz) > 4);
    const yaw = ahead ? Math.atan2(ahead[0] - sx, ahead[1] - sz) : quote.pickup.yaw;
    // Park on the kerb side of the road, not the centre line.
    const side = 2.6;
    const kerb: Vec2 = [sx + Math.cos(yaw) * side, sz - Math.sin(yaw) * side];
    const pickup = walkable(kerb[0], kerb[1], 0.5) ? kerb : quote.pickup.point;
    this.net.send("rideBook", {
      pickup,
      pickupYaw: yaw,
      dropoff: quote.dropoff.point,
      destination,
      label,
      roadMetres: Math.round(quote.plan.metres),
      express,
      idempotencyKey: crypto.randomUUID(),
    });
    if (express) this.beginExpressRide(label, quote.plan.points);
  }

  /** The express veil draws the real road route and drives a taxi along it, then shows the drop-off. */
  private beginExpressRide(label: string, points: Vec2[]) {
    if (points.length < 2) {
      this.beginTransfer(label);
      return;
    }
    this.showVeil("🚕", `Heading to ${label}…`, "Naija World Ride express", 2_700);
    const el = this.transfer?.el;
    if (!el) return;
    const step = Math.max(1, Math.ceil(points.length / 160));
    const route = points.filter((_, index) => index % step === 0 || index === points.length - 1);
    const xs = route.map((point) => point[0]);
    const zs = route.map((point) => point[1]);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const size = 240;
    const scale = (size - 40) / Math.max(maxX - minX, maxZ - minZ, 1);
    const offsetX = (size - (maxX - minX) * scale) / 2;
    const offsetY = (size - (maxZ - minZ) * scale) / 2;
    const projected = route.map(([px, pz]) => [offsetX + (px - minX) * scale, offsetY + (maxZ - pz) * scale] as const);
    const d = projected.map(([px, py], index) => `${index ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
    const [startX, startY] = projected[0]!;
    const [endX, endY] = projected.at(-1)!;
    const map = document.createElement("div");
    map.className = "express-map";
    map.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <rect x="0" y="0" width="${size}" height="${size}" rx="18" class="express-ground"/>
      <path d="${d}" class="express-road"/>
      <path d="${d}" class="express-trail" pathLength="1"/>
      <circle cx="${startX}" cy="${startY}" r="6" class="express-start"/>
      <circle cx="${endX}" cy="${endY}" r="8" class="express-end"/>
      <g class="express-taxi"><animateMotion dur="2.3s" fill="freeze" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.55 1" path="${d}"/>
        <rect x="-9" y="-5" width="18" height="10" rx="3" fill="#ffcf3a" stroke="#1a1a1a" stroke-width="1.5"/>
        <rect x="-2" y="-4" width="6" height="8" rx="1.5" fill="#25343a"/>
      </g>
    </svg>`;
    el.querySelector(".transfer-car")?.remove();
    el.prepend(map);
    const title = el.querySelector("strong");
    const caption = el.querySelector("small");
    setTimeout(() => {
      if (title) title.textContent = `Dropped off at ${label}`;
      if (caption) caption.textContent = "Thanks for riding · the driver pulls away";
      map.classList.add("arrived");
    }, 2_350);
  }

  /** Skips the rest of the current ride: the screen fades while the rider is placed at the drop-off. */
  skipRide() {
    if (!this.ride || !["approaching", "waiting", "riding"].includes(this.ride.status)) return;
    this.net.send("rideSkip");
    this.beginTransfer(this.ride.label);
  }

  private beginTransfer(label: string) {
    this.showVeil("🚕", `Heading to ${label}…`, "Naija World Ride express", 900);
  }

  private showVeil(icon: string, title: string, caption: string, minMs: number) {
    this.transfer?.el.remove();
    const el = document.createElement("div");
    el.className = icon === "fade" ? "transfer-veil plain" : "transfer-veil";
    el.setAttribute("data-testid", "transfer-veil");
    if (icon !== "fade") {
      el.innerHTML = `<span class="transfer-car" aria-hidden="true"></span><strong></strong><small></small>`;
      el.querySelector(".transfer-car")!.textContent = icon;
      el.querySelector("strong")!.textContent = title;
      el.querySelector("small")!.textContent = caption;
    }
    this.overlay.appendChild(el);
    this.transfer = { el, shownAt: performance.now(), arrivedAt: null, minMs };
  }

  /** Lifts the veil once the player has been moved and the tiles around them are built, or gives up after a few seconds. */
  private updateTransfer(now: number) {
    const transfer = this.transfer;
    if (!transfer) return;
    const age = now - transfer.shownAt;
    const settled = transfer.arrivedAt !== null && (this.interior || this.world.pendingNear() === 0) && age > transfer.minMs;
    // A plain fade lifts quickly when the server refuses the move (no arrival), so the player is never stuck behind it.
    const plain = transfer.minMs < 900;
    const timedOut = transfer.arrivedAt === null ? age > (plain ? 3_000 : 6_000) : now - transfer.arrivedAt > (plain ? 1_500 : 6_000);
    if (!settled && !timedOut) return;
    this.transfer = null;
    transfer.el.classList.add("leaving");
    setTimeout(() => transfer.el.remove(), 400);
  }

  /** Cancels before boarding, or asks the driver to pull over and end the trip early. */
  cancelRide() {
    if (this.rideCar && this.ride?.status === "riding") {
      this.rideCar.stopping = true;
      return;
    }
    this.net.send("rideCancel", { reason: "rider" });
  }

  /** Lagos or Dubai, from where the player stands. */
  playerRegion() {
    return this.interior ? regionOf(this.lastStreet[0], this.lastStreet[1]) : regionOf(this.controller.x, this.controller.z);
  }

  /** Metres left on the current ride, while riding. */
  rideRemaining() {
    return this.rideCar ? this.rideCar.pilot.remaining(this.rideCar.car) : null;
  }

  private onRide(ride: RideState | null) {
    this.ride = ride;
    this.callbacks.ride(ride);
    if (this.rideApproach && (ride?.status !== "approaching" || ride.id !== this.rideApproach.rideId)) {
      this.rideApproach.view.dispose();
      this.rideApproach.driver?.dispose();
      this.rideApproach = null;
    }
    if (ride?.status === "approaching" && !this.rideApproach) this.startRideApproach(ride);
  }

  /** Local-only view of the driver heading to the pickup along real roads, timed to the server's arrival. */
  private startRideApproach(ride: RideState) {
    if (!this.vehicleFactory) return;
    const seconds = Math.max(4, (ride.arrivesAt - Date.now()) / 1000);
    // Start on the road a short, town-speed drive away (about 7–10 m/s), preferring the same street.
    const reach = Math.min(140, Math.max(50, seconds * 8));
    const road = this.navigator.snap(ride.pickup);
    const candidates: Vec2[] = [-1, 1].map((side) => [road.point[0] - Math.sin(road.yaw) * reach * side, road.point[1] - Math.cos(road.yaw) * reach * side]);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      candidates.push([ride.pickup[0] + Math.sin(angle) * reach, ride.pickup[1] + Math.cos(angle) * reach]);
    }
    let best: RoutePlan | null = null;
    for (const candidate of candidates) {
      const start = this.navigator.snap(candidate);
      const plan = this.navigator.plan(start.point, ride.pickup);
      if (!plan.reachable || plan.metres < 30 || plan.metres > reach * 1.8) continue;
      if (!best || Math.abs(plan.metres - reach) < Math.abs(best.metres - reach)) best = plan;
    }
    if (!best) return;
    const path = best.points.filter((point, index, all) => index === 0 || Math.hypot(point[0] - all[index - 1]![0], point[1] - all[index - 1]![1]) > 0.5);
    const along = [0];
    for (let index = 1; index < path.length; index += 1) along.push(along[index - 1]! + Math.hypot(path[index]![0] - path[index - 1]![0], path[index]![1] - path[index - 1]![1]));
    const view = this.vehicleFactory.create(`ride-approach-${ride.id}`, ride.modelId, ride.colour);
    const dubai = regionOf(ride.pickup[0], ride.pickup[1]) === "dubai";
    addTaxiLivery(view, dubai ? "dubai" : "lagos");
    this.addCaster(view.meshes);
    view.setLights(true);
    this.rideApproach = { rideId: ride.id, view, driver: this.avatars ? this.avatars.create(`approach driver ${ride.id}`, dubai ? dubaiDriverLook(`ride-${ride.id}`) : taxiDriverLook(`ride-${ride.id}`)) : null, path, along, startAt: Date.now(), arrivesAt: ride.arrivesAt };
  }

  private updateRideApproach(dt: number) {
    const approach = this.rideApproach;
    if (!approach) return;
    const total = approach.along[approach.along.length - 1]!;
    const t = Math.max(0, Math.min(1, (Date.now() - approach.startAt) / Math.max(1, approach.arrivesAt - approach.startAt)));
    // Ease into the kerb over the last stretch.
    const s = total * (t < 0.85 ? t / 0.85 * 0.92 : 0.92 + (1 - (1 - (t - 0.85) / 0.15) ** 2) * 0.08);
    let index = 1;
    while (index < approach.along.length - 1 && approach.along[index]! < s) index += 1;
    const a = approach.path[index - 1]!;
    const b = approach.path[index]!;
    const span = Math.max(0.01, approach.along[index]! - approach.along[index - 1]!);
    const u = Math.max(0, Math.min(1, (s - approach.along[index - 1]!) / span));
    const x = a[0] + (b[0] - a[0]) * u;
    const z = a[1] + (b[1] - a[1]) * u;
    approach.view.setPose(x, this.interior ? -50 : this.world.groundHeight(x, z), z, Math.atan2(b[0] - a[0], b[1] - a[1]));
    approach.view.root.setEnabled(!this.interior);
    approach.view.track(dt);
    if (approach.driver) this.seatDriver(approach.driver, approach.view, dt);
  }

  private seatDriver(driver: Avatar, view: VehicleView, dt: number) {
    const seat = view.seat(0);
    driver.root.position.set(seat.x, this.interior ? -50 : this.world.groundHeight(seat.x, seat.z) + view.seatHeight(), seat.z);
    driver.root.rotation.y = seat.yaw;
    driver.update(0, "drive", dt);
  }

  /** Steps the NPC-driven ride car on the rider's client; the server checks speed and the drop-off. */
  private driveRide(dt: number, now: number) {
    const ride = this.ride;
    const passenger = this.passenger;
    if (!ride || ride.status !== "riding" || !passenger || passenger.vehicleId !== ride.vehicleId) return null;
    if (!this.rideCar || this.rideCar.vehicleId !== passenger.vehicleId) {
      const view = this.vehicles.get(passenger.vehicleId)?.view;
      if (!view) return null;
      const car = new CarController(view.model);
      car.place(view.x, view.z, view.yaw);
      const plan = this.navigator.plan([view.x, view.z], ride.dropoff);
      this.rideCar = { vehicleId: passenger.vehicleId, car, pilot: new RoutePilot(plan.points.slice(1), now, RIDE.driverSpeed, RIDE.laneOffset), stopping: false, sentAt: 0 };
    }
    const ridden = this.rideCar;
    const { car } = ridden;
    const result = ridden.stopping ? "stop" : ridden.pilot.step(car, now);
    const input = Array.isArray(result) ? { throttle: result[0], steer: result[1], handbrake: false } : { throttle: car.speed > 0.3 ? -1 : 0, steer: 0, handbrake: true };
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const [fromX, fromZ] = [car.x, car.z];
    for (let step = 0; step < steps; step += 1) car.step(dt / steps, input, car.model.topSpeed, this.collideCar);
    // Pressed against a kerb or wall the reported speed can stay above zero while the car no longer moves.
    const stopped = Math.abs(car.speed) < 0.8 || Math.hypot(car.x - fromX, car.z - fromZ) < 0.3 * dt;
    if (!Array.isArray(result) && now - ridden.sentAt > 3000 && stopped) {
      ridden.sentAt = now;
      if (result === "done") this.net.send("rideArrive");
      else this.net.send("rideCancel", { reason: result === "failed" ? "stuck" : "rider" });
    }
    return car;
  }

  /**
   * Shows a dealership model on the forecourt and circles the camera round it, in the game's own scene (a second
   * WebGL preview canvas runs phones out of graphics memory). Pass null to put the camera back.
   */
  showcaseVehicle(choice: { modelId: string; colour: string } | null) {
    if (!choice) {
      if (!this.showcase) return;
      this.showcase.view?.dispose();
      this.showcase = null;
      this.applyQualityStep(this.adaptive.level);
      return;
    }
    if (!this.vehicleFactory) return;
    // A single still view is cheap, so show the car at full resolution rather than the adaptive downscale.
    if (!this.showcase) this.engine.setHardwareScalingLevel(this.baseScaling);
    const place = getPlace(TEST_DRIVE.dealerPlaceId);
    const [dx, dz] = place.door;
    const point: Vec2 = [dx + Math.sin(place.facing) * 5.6, dz + Math.cos(place.facing) * 5.6];
    const current = this.showcase;
    if (current && current.modelId === choice.modelId && current.colour === choice.colour) return;
    const request = (current?.request ?? 0) + 1;
    const next = { view: current?.view ?? null, modelId: choice.modelId, colour: choice.colour, point, yaw: place.facing + Math.PI * 0.75, request };
    this.showcase = next;
    const factory = this.vehicleFactory;
    void factory.ensure(choice.modelId).then(() => {
      if (this.showcase !== next || this.disposed) return;
      next.view?.dispose();
      const view = factory.create(`showcase ${choice.modelId}`, choice.modelId, choice.colour);
      view.setDetail(true);
      view.setPose(point[0], this.world.groundHeight(point[0], point[1]), point[1], next.yaw);
      next.view = view;
    });
  }

  private updateShowcaseCamera(dt: number) {
    const showcase = this.showcase!;
    const model = getVehicleModel(showcase.modelId);
    const ground = this.world.groundHeight(showcase.point[0], showcase.point[1]);
    // Sweep back and forth on the street side; a full circle would pass through the showroom wall.
    this.showcaseAngle += dt * 0.3;
    const facing = getPlace(TEST_DRIVE.dealerPlaceId).facing;
    const angle = facing + Math.sin(this.showcaseAngle) * 1.05;
    const radius = Math.max(5.5, model.length * 1.45 + 1.5);
    // The dealership sheet covers the lower half, so aim below the car to lift it into the top half of the view.
    const height = Math.max(1.8, model.height + 0.9);
    const aim = height - Math.tan(0.42) * radius;
    const target = new Vector3(showcase.point[0], ground + aim, showcase.point[1]);
    const position = new Vector3(target.x + Math.sin(angle) * radius, ground + height, target.z + Math.cos(angle) * radius);
    this.cameraTarget.copyFrom(target);
    this.cameraPosition.copyFrom(position);
    this.camera.position.copyFrom(position);
    this.camera.setTarget(target);
  }

  testDrive(modelId: string, colour: string) {
    this.net.send("testDrive", { modelId, colour });
  }

  exitVehicle() {
    if (this.car && Math.abs(this.car.speed) >= 2) return;
    const riding = this.passenger ? this.vehicles.get(this.passenger.vehicleId)?.view : undefined;
    if (riding && Math.abs(riding.speed) >= 2) {
      this.callbacks.notice({ tone: "info", text: "Wait for the driver to stop before stepping out." });
      return;
    }
    this.net.send("exitVehicle");
  }

  /** Where each of the player's street vehicles is, for the phone and the map. */
  myVehicles() {
    return [...this.vehicles.values()].filter(({ state }) => state.mine).map(({ state, view }) => ({ id: state.id, x: view.x, z: view.z, plate: state.plate }));
  }

  /** Buildings and areas of the streamed tiles, for the maps. */
  mapLayer() {
    return this.world.mapLayer();
  }

  drivingVehicleId() {
    return this.driving?.vehicleId ?? null;
  }

  unstuck() {
    this.net.send("unstuck");
  }

  playEmote(emote: "wave" | "dance" | "sit" | "none") {
    this.emote = emote === "none" ? null : emote;
    this.net.send("emote", { emote });
  }

  stats() {
    return {
      ...this.world.stats,
      drawCalls: this.frameDrawCalls,
      cpuFrameMs: Math.round(this.frameMs * 10) / 10,
      updateMs: Math.round(this.updateMs * 10) / 10,
      activeMeshes: this.scene.getActiveMeshes().length,
      totalMeshes: this.scene.meshes.length,
      fps: Math.round(this.engine.getFps()),
    };
  }

  // ---- Development test harness ---------------------------------------------------------

  private runAutopilot(now: number) {
    const pilot = this.autopilot;
    if (!pilot) {
      this.forcedInput = null;
      return;
    }
    const { x, z } = this.controller;
    if (now > pilot.deadline) {
      this.autopilot = null;
      this.forcedInput = null;
      pilot.resolve(false);
      return;
    }
    let target = pilot.path[pilot.index]!;
    while (Math.hypot(target[0] - x, target[1] - z) < (pilot.index === pilot.path.length - 1 ? 0.6 : 1.4)) {
      pilot.index += 1;
      if (pilot.index >= pilot.path.length) {
        this.autopilot = null;
        this.forcedInput = null;
        pilot.resolve(true);
        return;
      }
      target = pilot.path[pilot.index]!;
    }
    if (Math.hypot(x - pilot.lastPoint[0], z - pilot.lastPoint[1]) > 0.8) {
      pilot.lastPoint = [x, z];
      pilot.lastProgress = now;
    } else if (now - pilot.lastProgress > 1500) {
      const dx = target[0] - x;
      const dz = target[1] - z;
      const length = Math.hypot(dx, dz) || 1;
      const side = Math.random() > 0.5 ? 1 : -1;
      pilot.path.splice(pilot.index, 0, [x + (-dz / length) * 2.5 * side + (dx / length) * 1, z + (dx / length) * 2.5 * side + (dz / length) * 1]);
      pilot.lastProgress = now;
      target = pilot.path[pilot.index]!;
    }
    const dx = target[0] - x;
    const dz = target[1] - z;
    const length = Math.hypot(dx, dz) || 1;
    const fx = Math.sin(this.cameraYaw);
    const fz = Math.cos(this.cameraYaw);
    const rx = Math.cos(this.cameraYaw);
    const rz = -Math.sin(this.cameraYaw);
    this.forcedInput = [(dx * rx + dz * rz) / length, (dx * fx + dz * fz) / length];
    const desiredYaw = Math.atan2(dx, dz);
    let delta = desiredYaw - this.cameraYaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.cameraYaw += delta * 0.05;
  }

  private installTestHooks() {
    const hooks = {
      state: () => ({
        x: this.controller.x,
        z: this.controller.z,
        yaw: this.controller.yaw,
        speed: this.controller.speed(),
        mode: this.controller.mode,
        location: this.self?.location ?? null,
        busId: this.self?.busId ?? null,
        seat: this.self?.seat ?? null,
        indoors: Boolean(this.interior),
        cameraYaw: this.cameraYaw,
      }),
      buses: () => [...this.buses.values()].map((bus) => ({ ...bus.state, cx: bus.root.position.x, cz: bus.root.position.z })),
      setCamera: (yaw: number, pitch?: number, distance?: number) => {
        this.cameraYaw = yaw;
        if (pitch !== undefined) this.cameraPitch = pitch;
        if (distance !== undefined) this.cameraDistance = distance;
      },
      key: (code: string, down: boolean) => this.input.simulate(code, down),
      look: (dx: number, dy = 0) => {
        this.input.lookDX += dx;
        this.input.lookDY += dy;
      },
      camera: () => {
        const look = this.camera.getTarget().subtract(this.camera.position);
        return { yaw: this.cameraYaw, pitch: this.cameraPitch, view: this.vehicleView, x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z, ground: this.groundY, lookYaw: Math.atan2(look.x, look.z) };
      },
      cycleCamera: () => this.cycleCamera(),
      /** Rendered distance between the player's avatar and their seat in the vehicle (null when not seated). */
      seatOffset: () => {
        const ride = this.driving ? { vehicleId: this.driving.vehicleId, seat: 0 } : this.passenger;
        const view = ride ? this.vehicles.get(ride.vehicleId)?.view : undefined;
        if (!view || !this.player) return null;
        const seat = view.seat(ride!.seat);
        return Math.hypot(this.player.root.position.x - seat.x, this.player.root.position.z - seat.z);
      },
      walkTo: (x: number, z: number, sprint = false, timeoutMs = 120_000) =>
        new Promise<boolean>((resolve) => {
          const path = this.navigator.route([this.controller.x, this.controller.z], [x, z]).slice(1);
          this.autopilot = { path, index: 0, sprint, resolve, lastProgress: performance.now(), lastPoint: [this.controller.x, this.controller.z], deadline: performance.now() + timeoutMs };
        }),
      walkDirect: (x: number, z: number, timeoutMs = 30_000) =>
        new Promise<boolean>((resolve) => {
          this.autopilot = { path: [[x, z]], index: 0, sprint: false, resolve, lastProgress: performance.now(), lastPoint: [this.controller.x, this.controller.z], deadline: performance.now() + timeoutMs };
        }),
      interact: () => this.triggerInteract(),
      couriers: () => this.couriers?.debug() ?? [],
      ride: () => this.ride,
      bikes: () => this.bikeStatus(),
      bookRide: (x: number, z: number, label: string) => this.bookRide([x, z], label),
      roadDistance: (x: number, z: number) => this.navigator.snap([x, z]).distance,
      ridePath: () => this.rideCar?.pilot.path ?? null,
      rideCar: () => (this.rideCar ? { x: this.rideCar.car.x, z: this.rideCar.car.z, speed: this.rideCar.car.speed, remaining: this.rideCar.pilot.remaining(this.rideCar.car) } : null),
      navigation: () => this.navigation(),
      navigate: (point: Vec2, label: string) => this.setWaypoint({ point, label }),
      route: () => this.routePoints,
      plan: (from: Vec2, to: Vec2, approach?: Vec2) => this.navigator.plan(from, to, approach),
      honks: () => this.life?.honks ?? 0,
      cameraInsideCar: () => Boolean(this.life?.carAt(this.camera.position.x, this.camera.position.y, this.camera.position.z, 0)),
      lanesAhead: (seconds: number) => this.life?.lanesAhead(seconds) ?? [],
      prompt: () => this.prompt,
      board: (id: string) => this.board(id),
      requestStop: () => this.requestStop(),
      junctions: () => this.world.junctionSigns,
      stops: () => STOPS.map(({ route, ...stop }) => ({ ...stop, routeId: route.routeId })),
      places: () => PLACES.map((place) => ({ id: place.id, name: place.name, kind: place.kind, door: place.door, kerb: place.kerb, facing: place.facing })),
      plots: () => PLOTS.map((plot) => ({ id: plot.id, gate: plot.gate, door: houseDoor(plot), state: this.plotStates.find((entry) => entry.id === plot.id) ?? null })),
      stats: () => this.stats(),
      loadedTiles: () => this.world.loadedTiles(),
      meshSummary: () => {
        const counts: Record<string, number> = {};
        for (const mesh of this.scene.meshes) {
          const key = `${mesh.name.split(" ")[0]}${mesh.isEnabled() ? "" : "(off)"}${mesh.isVisible ? "" : "(hidden)"}`;
          counts[key] = (counts[key] ?? 0) + 1;
        }
        return counts;
      },
      setMaxFrameDt: (seconds: number) => {
        this.maxFrameDt = seconds;
      },
      vehicles: () => [...this.vehicles.values()].map(({ state, view }) => ({ ...state, cx: view.x, cz: view.z })),
      driving: () => (this.car && this.driving ? { ...this.driving, x: this.car.x, z: this.car.z, yaw: this.car.yaw, speed: this.car.speed } : null),
      enterVehicle: (id: string) => this.enterVehicle(id),
      exitVehicle: () => this.exitVehicle(),
      driveTo: (x: number, z: number, timeoutMs = 120_000) =>
        new Promise<boolean>((resolve) => {
          if (!this.car) return resolve(false);
          const path = this.navigator.route([this.car.x, this.car.z], [x, z]).slice(1);
          this.carPilot = { path: path.length ? path : [[x, z]], index: 0, resolve, deadline: performance.now() + timeoutMs, stuckSince: null, recovery: null, recoveries: 0 };
        }),
      fps: () => this.engine.getFps(),
      signAtlasLive: () => Boolean(this.atlas.texture.getInternalTexture()),
      gpu: () => ({
        lost: (this.engine as unknown as { _gl: WebGLRenderingContext })._gl.isContextLost(),
        textures: this.scene.textures.length,
        cached: this.engine.getLoadedTexturesCache().length,
        materials: this.scene.materials.length,
        meshes: this.scene.meshes.length,
        geometries: this.scene.geometries.length,
        frames: this.engine.frameId,
        signs: this.atlas.usage(),
      }),
      quality: () => ({ step: this.adaptive.level, scaling: this.engine.getHardwareScalingLevel(), shadows: this.sun.shadowEnabled, viewDistance: this.camera.maxZ, fogDensity: this.scene.fogDensity }),
      meshesNamed: (prefix: string) =>
        this.scene.meshes
          .filter((mesh) => mesh.name.startsWith(prefix))
          .map((mesh) => {
            const box = mesh.getBoundingInfo().boundingBox;
            return { name: mesh.name, enabled: mesh.isEnabled(), visible: mesh.isVisible, centre: box.centerWorld.asArray(), size: box.extendSizeWorld.asArray() };
          }),
      appearance: () => this.player?.appearance ?? null,
      emote: (emote: "wave" | "dance" | "sit" | "none") => this.playEmote(emote),
      fastTravel: (placeId: string) => this.fastTravel({ placeId }, placeId),
      enterProperty: (propertyId: string, mode: "enter" | "preview") => this.enterProperty(propertyId, mode),
      room: () => (this.interior && !this.travelView ? (this.interior as InteriorView).bounds : null),
      repair: () => ({ site: this.repairSite?.site.at ?? null, stand: this.repairSite?.site.stand ?? null, workingFor: this.repairing ? Math.max(0, this.repairing.until - performance.now()) : 0 }),
      repairWork: (seconds: number) => this.repairWork(seconds),
      remoteAppearances: () =>
        Object.fromEntries([...this.remotes].map(([sessionId, remote]) => [remote.tag.textContent ?? sessionId, remote.avatar?.appearance ?? null])),
    };
    (window as unknown as { __lagos: typeof hooks }).__lagos = hooks;
  }

  private assertLive() {
    if (this.disposed) throw new EngineDisposedError();
  }

  async dispose() {
    this.endTour();
    this.setRepairSite(null);
    for (const prop of this.streetProps.splice(0)) prop.dispose();
    this.disposed = true;
    window.removeEventListener("resize", this.resize);
    await this.net.disconnect().catch(() => undefined);
    this.input?.dispose();
    this.audio.dispose();
    this.life?.dispose();
    syncPlotFootprints([]);
    for (const remote of this.remotes.values()) remote.tag.remove();
    this.spotters?.clear();
    this.tout?.tag.remove();
    for (const tag of this.busTags.values()) tag.remove();
    for (const { tag } of this.vehicles.values()) tag.remove();
    this.engine?.stopRenderLoop();
    this.scene?.dispose();
    this.engine?.dispose();
  }
}

export { defaultBindings, defaultSettings };
