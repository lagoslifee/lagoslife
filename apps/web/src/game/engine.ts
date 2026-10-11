import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Helpers/sceneHelpers";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import "@babylonjs/core/Culling/ray";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
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
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import {
  defaultSettings,
  effectiveTopSpeed,
  getPlace,
  getVehicleModel,
  INTERACTION_RANGE,
  VEHICLE_RULES,
  type WorldVehicle,
  blockedByWater,
  builtHomeId,
  houseDesign,
  houseDoor,
  PLOT_TERMS,
  PLOTS,
  syncPlotFootprints,
  defaultAppearance,
  districtAt,
  insideBuilding,
  INTERIOR_ORIGIN,
  MOVEMENT,
  PLACES,
  propertyTitle,
  resolveBuildingCollision,
  getRoute,
  STOPS,
  stopById,
  stopLabel,
  withinWorld,
  type BusState,
  type CharacterAppearance,
  type ChatMessage,
  type Look,
  type MotionState,
  type NetworkPlayer,
  type Notice,
  type Place,
  type PlayerSettings,
  type SelfState,
  type Vec2,
  RIDE,
  walkable,
  BIKE_RENTAL,
  BIKE_STATIONS,
  nearestBikeStation,
  rentalUsage,
  type RideState,
} from "@lagos-living/shared";
import { apiUrl, authHeaders } from "../auth-client";
import type { PlotState } from "../api";
import { buildProgress } from "./build-progress";
import { PlotsView } from "./plots";
import { MultiplayerConnection, type MultiplayerStatus } from "../multiplayer";
import { AdaptiveQuality, FULL_FOG_DENSITY, FULL_VIEW_DISTANCE, MAX_AUTO_SCALING, qualityStep } from "./adaptive-quality";
import { CityAudio } from "./audio";
import { Avatar, AvatarFactory } from "./avatar";
import { CarController } from "./car-controller";
import { VehicleFactory, type VehicleView } from "./vehicles";
import { guide, type Guidance, type RoutePlan } from "./navigation";
import { RoutePilot } from "./route-pilot";
import { BikeStationsView } from "./bike-stations";
import { defaultBindings, InputState, LocomotionController, MAX_FRAME_DT, SUBSTEP_DT, type Bindings, type MoveMode } from "./controller";
import { DanfoFactory, type DanfoView } from "./danfo";
import { MeshBuilderBatch } from "./geometry";
import { buildInterior, type InteriorKind, type InteriorSpot, type InteriorView, type Placement } from "./interior";
import { createMaterials, type Materials, type Quality } from "./materials";
import { SignAtlas } from "./sign-atlas";
import { RoadNavigator, StreetTracker, type WorldData, type WorldTile } from "./street-index";
import { AmbientLife } from "./traffic";
import { buildWorld, type BuiltWorld } from "./world-builder";

export type Prompt = { key: string; label: string; detail?: string | undefined; disabled?: boolean };

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
  | { kind: "interior"; spot: InteriorSpot["id"] }
  | { kind: "plot"; plotId: string };

export type EngineCallbacks = {
  hud: (state: HudState) => void;
  notice: (notice: Notice) => void;
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
  /** WebGL context lost/restored by the browser, or frames failing repeatedly. */
  graphics: (event: "lost" | "restored" | "failed") => void;
};

type Remote = {
  avatar: Avatar | null;
  tag: HTMLDivElement;
  samples: Array<{ t: number; x: number; z: number; yaw: number; motion: MotionState; busId: string | null; vehicleId: string | null; vehicleSeat: number | null }>;
  speed: number;
  lastSeen: number;
};

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
};

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
  private looks = new Map<string, CharacterAppearance>();
  private appearance: CharacterAppearance = defaultAppearance;
  private buses = new Map<string, DanfoView>();
  private busTags = new Map<string, HTMLDivElement>();
  private interior: InteriorView | null = null;
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
  private waypoint: { point: Vec2; label: string } | null = null;
  private beacon: Mesh | null = null;
  private routeMesh: Mesh | null = null;
  private routeMaterial: PBRMaterial | null = null;
  private lastRoute = { at: 0, x: 0, z: 0 };
  private routePlan: RoutePlan | null = null;
  private guidance: Guidance | null = null;
  private reroutedAt = 0;
  private routePoints: Vec2[] = [];
  private emote: MotionState | null = null;
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
  private baseScaling = 1;
  private autopilot: { path: Vec2[]; index: number; sprint: boolean; resolve: (ok: boolean) => void; lastProgress: number; lastPoint: Vec2; deadline: number } | null = null;
  private forcedInput: [number, number] | null = null;
  private readyFired = false;
  private vehicleFactory: VehicleFactory | null = null;
  private vehicles = new Map<string, { view: VehicleView; state: WorldVehicle; tag: HTMLDivElement; driver: Avatar | null }>();
  private ride: RideState | null = null;
  private bikeStock: Record<string, number> = {};
  private bikeStations: BikeStationsView | null = null;
  private rideCar: { vehicleId: string; car: CarController; pilot: RoutePilot; stopping: boolean; sentAt: number } | null = null;
  private rideApproach: { rideId: string; view: VehicleView; driver: Avatar | null; path: Vec2[]; along: number[]; startAt: number; arrivesAt: number } | null = null;
  private car: CarController | null = null;
  private driving: { vehicleId: string; condition: number } | null = null;
  private lights = false;
  private passenger: { vehicleId: string; seat: number } | null = null;
  private pendingDrive: string | null = null;
  private lastContactAt = 0;
  private lastImpactSentAt = 0;
  private lastLookAt = 0;
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
    this.controller = new LocomotionController((x, z) => this.collide(x, z));
    this.audio = new CityAudio(settings);
    this.net = new MultiplayerConnection({
      snapshot: (snapshot, own) => this.onSnapshot(snapshot, own),
      self: (self) => this.onSelf(self),
      notice: (notice) => {
        this.callbacks.notice(notice);
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
      ride: (ride) => this.onRide(ride),
      bikeStock: (stock) => {
        this.bikeStock = stock;
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
    this.baseScaling = this.quality === "low" ? 1.5 : this.quality === "medium" ? Math.max(1, dpr / 1.25) / dpr : 1 / Math.min(dpr, 1.5);
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
    this.atlas = new SignAtlas(scene);
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
      this.addCaster(this.player.meshes);
    } else {
      this.playerFallback = MeshBuilder.CreateCapsule("player", { height: 1.76, radius: 0.3 }, scene);
    }
    this.parcel = MeshBuilder.CreateBox("parcel", { width: 0.42, height: 0.3, depth: 0.32 }, scene);
    const cardboard = new PBRMaterial("cardboard", scene);
    cardboard.albedoColor = Color3.FromHexString("#b0844f");
    cardboard.roughness = 0.9;
    this.parcel.material = cardboard;
    this.parcel.setEnabled(false);

    this.life = new AmbientLife(scene, this.world, this.data.roads, this.materials, this.avatars, this.quality);
    this.life.onHonk = () => {
      this.audio.horn(0.8);
      this.caption("A car honks — you are blocking the road");
    };
    this.vehicleFactory = new VehicleFactory(scene, this.materials);
    this.bikeStations = new BikeStationsView(scene, this.materials, (x, z) => this.world.groundHeight(x, z), this.vehicleFactory, (meshes) => this.addCaster(meshes));

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
    engine.onContextLostObservable.add(() => this.callbacks.graphics("lost"));
    engine.onContextRestoredObservable.add(() => this.callbacks.graphics("restored"));
    // Babylon only queues the next frame after this callback returns, so one thrown error would freeze the game for good.
    engine.runRenderLoop(() => {
      if (this.disposed) return;
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
    if (import.meta.env.DEV) this.installTestHooks();
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

  private collide(x: number, z: number): [number, number] {
    if (this.interior) return this.interior.collide(x, z, MOVEMENT.radius);
    let [px, pz] = resolveBuildingCollision(x, z, MOVEMENT.radius);
    [px, pz] = this.world.obstacles.resolve(px, pz, MOVEMENT.radius);
    for (const bus of this.buses.values()) [px, pz] = bus.pushOut(px, pz, MOVEMENT.radius);
    for (const { view } of this.vehicles.values()) [px, pz] = view.pushOut(px, pz, MOVEMENT.radius);
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
    const handbrake = this.input.held("jump") || this.input.touchSprint;
    const topSpeed = effectiveTopSpeed(car.model, driving.condition);
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP_DT));
    let impact = 0;
    for (let step = 0; step < steps; step += 1) {
      impact = Math.max(impact, car.step(dt / steps, { throttle, steer, handbrake }, topSpeed, this.collideCar));
    }
    if (impact >= VEHICLE_RULES.impactMinSpeed && now - this.lastContactAt > 600 && now - this.lastImpactSentAt > 900) {
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
        entry?.view.dispose();
        entry?.tag.remove();
        entry?.driver?.dispose();
        const view = this.vehicleFactory.create(state.id, state.modelId, state.colour);
        this.addCaster(view.meshes);
        const tag = document.createElement("div");
        tag.className = "world-tag vehicle-tag";
        this.overlay.appendChild(tag);
        entry = { view, state, tag, driver: state.npc && this.avatars ? this.avatars.create(`driver ${state.id}`) : null };
        this.vehicles.set(state.id, entry);
        view.setPose(state.x, this.world.groundHeight(state.x, state.z), state.z, state.yaw);
      }
      entry.state = state;
      if (state.id !== this.driving?.vehicleId) entry.view.setLights(state.lights);
      entry.tag.textContent = `${state.plate} · ${state.mine ? "Your car" : state.ownerName}`;
      if (state.driverSessionId) entry.view.push(now, state.x, state.z, state.yaw);
    }
    for (const [id, entry] of this.vehicles) {
      if (seen.has(id) || id === this.driving?.vehicleId) continue;
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
    for (const [id, { view, state, driver }] of this.vehicles) {
      let pose: { x: number; z: number; yaw: number } | null;
      const rideCar = this.rideCar?.vehicleId === id ? this.rideCar.car : null;
      const mine = (id === this.driving?.vehicleId && this.car) || rideCar;
      if (rideCar) pose = rideCar;
      else if (mine) pose = this.car;
      else if (state.driverSessionId) pose = view.sample(now);
      else pose = state;
      if (pose) view.setPose(pose.x, this.interior ? -50 : this.world.groundHeight(pose.x, pose.z), pose.z, pose.yaw);
      view.root.setEnabled(!this.interior);
      if (this.interior) continue;
      const car = rideCar ?? this.car;
      if (mine && car) view.animate(dt, { speed: car.speed, steer: car.steer, braking: car.braking, accel: car.accel, yawRate: car.yawRate });
      else view.track(dt);
      if (driver) this.seatDriver(driver, view, dt);
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
    const dt = Math.min(this.maxFrameDt, this.engine.getDeltaTime() / 1000);
    this.frameTimes.push(this.engine.getDeltaTime());
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    if (this.readyFired && this.settings.autoGraphics && !document.hidden) {
      const level = this.adaptive.sample(this.engine.getDeltaTime(), now);
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
      if (move[0] || move[1]) this.emote = null;
      const steps = Math.max(1, Math.ceil(dt / SUBSTEP_DT));
      for (let step = 0; step < steps; step += 1) this.controller.step(dt / steps, move, this.cameraYaw, mode);
      if (this.input.consume("jump")) this.controller.jump();
      if (this.input.consume("interact")) this.interaction?.();
      this.input.consume("stop");
    }

    const { x, z } = this.controller;
    const targetGround = this.interior ? 0.02 : this.world.groundHeight(x, z);
    this.groundY += (targetGround - this.groundY) * Math.min(1, dt * 12);
    const inCar = Boolean(this.car && this.driving);
    const speed = inCar ? Math.abs(this.car!.speed) : this.controller.speed();
    const motion: MotionState = inCar ? "drive" : this.passenger ? "sit" : this.emote && speed < 0.1 ? this.emote : bus ? "sit" : this.controller.motion();
    const ride = inCar ? { vehicleId: this.driving!.vehicleId, seat: 0 } : this.passenger;
    const seatView = ride ? this.vehicles.get(ride.vehicleId)?.view : undefined;
    if (this.player && seatView && ride) {
      const seat = seatView.seat(ride.seat);
      this.player.root.position.set(seat.x, this.world.groundHeight(seat.x, seat.z) + seatView.seatHeight(), seat.z);
      this.player.root.rotation.y = seat.yaw;
      this.player.root.setEnabled(true);
      this.player.update(0, "sit", dt);
      if (seatView.model.body === "bicycle" && ride.seat === 0) this.player.pedal(seatView.crank);
    } else if (this.player) {
      this.player.root.position.set(x, this.groundY + this.controller.hop, z);
      this.player.root.rotation.y = this.controller.yaw;
      this.player.root.setEnabled(!bus && !inCar);
      if (!inCar) this.player.update(speed, motion, dt);
    } else if (this.playerFallback) {
      this.playerFallback.position.set(x, this.groundY + 0.88, z);
      this.playerFallback.setEnabled(!bus && !inCar);
    }
    if (this.parcel?.isEnabled()) {
      const yaw = this.controller.yaw;
      this.parcel.position.set(x + Math.sin(yaw) * 0.32, this.groundY + 1.08, z + Math.cos(yaw) * 0.32);
      this.parcel.rotation.y = yaw;
    }

    this.updateCamera(dt, bus);
    if (!bus && now - this.lastSend > 66) {
      const moved = Math.hypot(x - this.lastSent.x, z - this.lastSent.z) > 0.02 || motion !== this.lastSent.motion;
      if (moved || now - this.lastSend > 1000) {
        this.net.sendPosition(x, z, this.controller.yaw, motion);
        this.lastSent = { x, z, motion };
        this.lastSend = now;
      }
    }

    this.updateRemotes(now, dt);
    this.updateVehicles(now, dt);
    if (!this.interior) {
      this.world.stream(x, z);
      this.world.pump(this.readyFired ? 8 : 200);
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

  private updateCamera(dt: number, bus: DanfoView | null) {
    const rideView = !this.driving && this.passenger ? this.vehicles.get(this.passenger.vehicleId)?.view : undefined;
    const car = this.driving && this.car ? this.car : rideView ? { x: rideView.x, z: rideView.z, yaw: rideView.yaw, speed: rideView.speed, model: rideView.model } : null;
    const target = bus
      ? new Vector3(bus.root.position.x, 2.1, bus.root.position.z)
      : car
        ? new Vector3(car.x, this.groundY + Math.max(1.2, car.model.height * 0.9), car.z)
        : new Vector3(this.controller.x, this.groundY + 1.55, this.controller.z);
    if (car && performance.now() - this.lastLookAt > 1200 && Math.abs(car.speed) > 1) {
      let delta = car.yaw - this.cameraYaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.cameraYaw += delta * Math.min(1, dt * (car.speed > 0 ? 3 : 1.5));
      this.cameraPitch += (0.26 - this.cameraPitch) * Math.min(1, dt * 1.5);
    }
    const lag = 1 - Math.exp(-dt * (car ? 12 : 20));
    this.cameraTarget.addInPlace(target.subtract(this.cameraTarget).scale(lag));
    const chase = car ? car.model.length * 1.15 + 2.6 + Math.abs(car.speed) * 0.08 : 8.5;
    const distance = bus || car ? Math.max(this.cameraDistance, chase) : this.interior ? Math.min(this.cameraDistance, 3.6) : this.cameraDistance;
    const cosPitch = Math.cos(this.cameraPitch);
    const dir = new Vector3(Math.sin(this.cameraYaw) * cosPitch, Math.sin(this.cameraPitch), Math.cos(this.cameraYaw) * cosPitch);
    let allowed = distance;
    if (this.interior) {
      const [ox, oz] = INTERIOR_ORIGIN;
      for (let d = 0.4; d <= distance; d += 0.2) {
        const px = this.cameraTarget.x - dir.x * d;
        const pz = this.cameraTarget.z - dir.z * d;
        if (Math.abs(px - ox) > 5.3 || Math.abs(pz - oz) > 4.5) {
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
    const position = this.cameraTarget.subtract(dir.scale(allowed));
    position.y = Math.max(position.y, (this.interior ? 0.3 : this.groundY + 0.35));
    if (this.interior) position.y = Math.min(position.y, 2.45);
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
    if (this.interior) {
      for (const spot of this.interior.spots) {
        if (Math.hypot(spot.point[0] - x, spot.point[1] - z) < 1.6) {
          this.prompt = { key: bind("interact"), label: spot.label };
          this.interaction = spot.id === "exit" ? () => this.exitProperty() : () => this.callbacks.interact({ kind: "interior", spot: spot.id });
          return;
        }
      }
      return;
    }
    let best: { distance: number; prompt: Prompt; run: () => void } | null = null;
    const offer = (distance: number, prompt: Prompt, run: () => void) => {
      if (!best || distance < best.distance) best = { distance, prompt, run };
    };
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
      if (state.npc) {
        const ride = this.ride;
        if (ride?.vehicleId === state.id && ride.status === "waiting") {
          offer(distance - 1, { key: bind("interact"), label: "Get in · Lagos Living Ride", detail: `${ride.driverName} · ${ride.plate} → ${ride.label}` }, () => this.net.send("rideBoard"));
        } else {
          offer(distance + 1, { key: "🚕", label: state.ownerName, detail: "Booked by another rider", disabled: true }, () => undefined);
        }
        continue;
      }
      if (state.mine && !state.driverSessionId) {
        offer(distance - 0.5, { key: bind("interact"), label: `${view.model.body === "bicycle" ? "Ride" : "Drive"} ${view.model.name}`, detail: `${state.plate} · ${state.locked ? "locked" : "unlocked"}` }, () => this.enterVehicle(state.id));
      } else if (state.mine || state.testDriveEndsAt) {
        continue;
      } else if (state.locked) {
        offer(distance + 1, { key: "🔒", label: `${state.ownerName}'s ${view.model.name}`, detail: "Locked", disabled: true }, () => undefined);
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
    for (const place of PLACES) {
      const distance = Math.hypot(place.door[0] - x, place.door[1] - z);
      if (distance > INTERACTION_RANGE + (place.kind === "rental" || place.kind === "sale" ? 2 : 0)) continue;
      if (place.kind === "delivery") {
        if (this.deliveryTarget && Math.hypot(this.deliveryTarget.point[0] - place.door[0], this.deliveryTarget.point[1] - place.door[1]) < 1) {
          offer(distance, { key: bind("interact"), label: "Deliver parcel", detail: place.name }, () => this.callbacks.interact({ kind: "delivery" }));
        }
        continue;
      }
      offer(distance, { key: bind("interact"), label: `${PLACE_ACTIONS[place.kind]} · ${place.name}`, detail: place.street }, () =>
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
      street = this.self?.propertyId ? propertyTitle(this.self.propertyId) : "Indoors";
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
      district: district ? `${district.name} · ${district.lga}` : "Lagos",
      location: bus ? "bus" : this.interior ? "interior" : "street",
      interiorTitle: this.interior && this.self?.propertyId ? propertyTitle(this.self.propertyId) : null,
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

  private vehicleHud(car: CarController, driving: { vehicleId: string; condition: number }) {
    const top = effectiveTopSpeed(car.model, driving.condition);
    return {
      id: driving.vehicleId,
      name: car.model.name,
      plate: this.vehicles.get(driving.vehicleId)?.state.plate ?? "",
      kmh: Math.round(Math.abs(car.speed) * 3.6),
      topKmh: Math.round(top * 3.6),
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

  private onSnapshot(snapshot: { players: NetworkPlayer[]; buses: BusState[]; vehicles: WorldVehicle[]; online: number }, own: string) {
    const now = performance.now();
    this.online = snapshot.online;
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
    for (const player of snapshot.players) {
      if (player.sessionId === own) continue;
      seen.add(player.sessionId);
      let remote = this.remotes.get(player.sessionId);
      if (!remote) {
        const tag = document.createElement("div");
        tag.className = "world-tag";
        tag.textContent = player.name;
        this.overlay.appendChild(tag);
        const avatar = this.avatars?.create(`remote-${player.sessionId}`, this.looks.get(player.sessionId) ?? defaultAppearance) ?? null;
        if (avatar) this.addCaster(avatar.meshes);
        remote = { avatar, tag, samples: [], speed: 0, lastSeen: now };
        this.remotes.set(player.sessionId, remote);
      }
      remote.lastSeen = now;
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
    for (const { sessionId, appearance } of looks) {
      if (sessionId === this.net.sessionId) {
        this.setAppearance(appearance);
        continue;
      }
      this.looks.set(sessionId, appearance);
      this.remotes.get(sessionId)?.avatar?.setAppearance(appearance);
    }
    if (this.looks.size > 400) {
      for (const sessionId of this.looks.keys()) {
        if (this.looks.size <= 200) break;
        if (!this.remotes.has(sessionId)) this.looks.delete(sessionId);
      }
    }
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
        remote.avatar.root.position.set(seat.x, this.world.groundHeight(seat.x, seat.z) + seatView.seatHeight(), seat.z);
        remote.avatar.root.rotation.y = seat.yaw;
        remote.avatar.root.setEnabled(true);
        remote.avatar.update(0, "sit", dt);
        if (seatView.model.body === "bicycle" && (b.vehicleSeat ?? 0) === 0) remote.avatar.pedal(seatView.crank);
      } else if (remote.avatar) {
        remote.avatar.root.position.set(x, this.interior ? 0.02 : this.world.groundHeight(x, z), z);
        remote.avatar.root.rotation.y = a.yaw + dyaw * t;
        remote.avatar.root.setEnabled(!b.busId && !b.vehicleId);
        remote.avatar.update(remote.speed, b.motion, dt);
      }
    }
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
    if (self.reason === "alighted" && previous?.busId) this.justAlighted = { busId: previous.busId, at: performance.now() };
    const enteringInterior = self.location !== "street" && (!previous || previous.location !== self.location);
    const leavingInterior = self.location === "street" && this.interior;
    if (leavingInterior) {
      this.interior?.dispose();
      this.interior = null;
    }
    if (enteringInterior) void this.loadInterior(self);
    const seat = self.vehicleSeat ?? 0;
    if (self.vehicleId && seat === 0 && self.vehicleId !== this.driving?.vehicleId) this.startDriving(self.vehicleId);
    if ((!self.vehicleId || seat > 0) && (this.driving || this.pendingDrive)) this.stopDriving();
    this.passenger = self.vehicleId && seat > 0 ? { vehicleId: self.vehicleId, seat } : null;
    if (this.rideCar && this.passenger?.vehicleId !== this.rideCar.vehicleId) this.rideCar = null;
    if (this.passenger) {
      const view = this.vehicles.get(this.passenger.vehicleId)?.view;
      if (view) this.cameraYaw = view.yaw;
    }
    if (!self.busId) {
      this.controller.teleport(self.x, self.z);
      if (self.reason === "alighted" || self.reason === "exited" || self.reason === "recovered" || self.reason === "parked" || !previous) this.snapCamera();
    }
    if (self.reason === "entered" || self.reason === "preview") {
      this.cameraYaw = 0;
      this.cameraPitch = 0.16;
      this.snapCamera();
    }
    this.callbacks.self(self);
  }

  private async loadInterior(self: SelfState) {
    const kind: InteriorKind = self.location.startsWith("starter:") ? "starter" : self.previewOnly ? "preview" : "home";
    const title = self.propertyId ? propertyTitle(self.propertyId) : "Home";
    let placements: Placement[] = [];
    if (kind === "home" && self.propertyId) {
      const response = await fetch(`${apiUrl}/api/properties/${self.propertyId}/interior`, { credentials: "include", headers: authHeaders() }).catch(() => null);
      if (response?.ok) placements = ((await response.json()) as { furniture: Placement[] }).furniture;
      else this.callbacks.notice({ tone: "error", text: "Could not load your furniture — showing an empty room." });
    }
    if (this.self?.location !== self.location) return;
    this.interior?.dispose();
    this.interior = buildInterior(this.scene, this.materials, this.atlas, kind, title, placements);
  }

  async refreshInterior() {
    if (this.self && this.self.location !== "street") {
      this.interior?.dispose();
      this.interior = null;
      await this.loadInterior(this.self);
    }
  }

  private updateWaypoint(now: number) {
    const target = this.waypoint;
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
    this.beacon.setEnabled(true);
    this.beacon.position.set(target.point[0], 20, target.point[1]);
    const { x, z } = this.controller;
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
      this.routePlan = this.navigator.plan([x, z], target.point);
      this.routePoints = this.routePlan.points;
      this.guidance = guide(this.routePlan, [x, z]);
      this.routeMesh?.dispose();
      const batch = new MeshBuilderBatch("route");
      const points = this.routePoints.filter((point, index, all) => index === 0 || Math.hypot(point[0] - all[index - 1]![0], point[1] - all[index - 1]![1]) > 0.3);
      if (points.length >= 2) batch.ribbon(points, -0.22, 0.22, 0.22, 1);
      if (!this.routeMaterial) {
        this.routeMaterial = new PBRMaterial("route glow", this.scene);
        this.routeMaterial.unlit = true;
        this.routeMaterial.albedoColor = Color3.FromHexString("#2fd3ff");
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

  setWaypoint(target: { point: Vec2; label: string } | null) {
    const same = target && this.waypoint && target.point[0] === this.waypoint.point[0] && target.point[1] === this.waypoint.point[1];
    this.waypoint = target;
    if (!same) this.lastRoute.at = 0;
    if (!target) {
      this.routePlan = null;
      this.guidance = null;
    }
  }

  setDeliveryTarget(target: { point: Vec2; label: string } | null) {
    this.deliveryTarget = target;
    this.parcel?.setEnabled(Boolean(target));
    this.net.send("carrying", Boolean(target));
  }

  setSettings(settings: PlayerSettings) {
    this.settings = settings;
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
    this.net.send("enterProperty", { propertyId, mode });
  }

  exitProperty() {
    this.net.send("exitProperty");
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

  bookRide(destination: Vec2, label: string) {
    const quote = this.rideQuote(destination);
    // Park on the kerb side of the road, not the centre line.
    const side = 2.6;
    const kerb: Vec2 = [quote.pickup.point[0] + Math.cos(quote.pickup.yaw) * side, quote.pickup.point[1] - Math.sin(quote.pickup.yaw) * side];
    const pickup = walkable(kerb[0], kerb[1], 0.5) ? kerb : quote.pickup.point;
    this.net.send("rideBook", {
      pickup,
      pickupYaw: quote.pickup.yaw,
      dropoff: quote.dropoff.point,
      destination,
      label,
      roadMetres: Math.round(quote.plan.metres),
      idempotencyKey: crypto.randomUUID(),
    });
  }

  /** Cancels before boarding, or asks the driver to pull over and end the trip early. */
  cancelRide() {
    if (this.rideCar && this.ride?.status === "riding") {
      this.rideCar.stopping = true;
      return;
    }
    this.net.send("rideCancel", { reason: "rider" });
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
    const seconds = Math.max(10, (ride.arrivesAt - Date.now()) / 1000);
    const reach = Math.min(650, Math.max(180, seconds * RIDE.driverSpeed));
    let best: RoutePlan | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const start = this.navigator.snap([ride.pickup[0] + Math.sin(angle) * reach * 0.8, ride.pickup[1] + Math.cos(angle) * reach * 0.8]);
      const plan = this.navigator.plan(start.point, ride.pickup);
      if (plan.reachable && plan.metres > 120 && (!best || Math.abs(plan.metres - reach) < Math.abs(best.metres - reach))) best = plan;
    }
    if (!best) return;
    const path = best.points.filter((point, index, all) => index === 0 || Math.hypot(point[0] - all[index - 1]![0], point[1] - all[index - 1]![1]) > 0.5);
    const along = [0];
    for (let index = 1; index < path.length; index += 1) along.push(along[index - 1]! + Math.hypot(path[index]![0] - path[index - 1]![0], path[index]![1] - path[index - 1]![1]));
    const view = this.vehicleFactory.create(`ride-approach-${ride.id}`, ride.modelId, ride.colour);
    this.addCaster(view.meshes);
    view.setLights(true);
    this.rideApproach = { rideId: ride.id, view, driver: this.avatars ? this.avatars.create(`approach driver ${ride.id}`) : null, path, along, startAt: Date.now(), arrivesAt: ride.arrivesAt };
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
      this.rideCar = { vehicleId: passenger.vehicleId, car, pilot: new RoutePilot(plan.points.slice(1), now, RIDE.driverSpeed), stopping: false, sentAt: 0 };
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
      ride: () => this.ride,
      bikes: () => this.bikeStatus(),
      rideCar: () => (this.rideCar ? { x: this.rideCar.car.x, z: this.rideCar.car.z, speed: this.rideCar.car.speed, remaining: this.rideCar.pilot.remaining(this.rideCar.car) } : null),
      navigation: () => this.navigation(),
      navigate: (point: Vec2, label: string) => this.setWaypoint({ point, label }),
      honks: () => this.life?.honks ?? 0,
      cameraInsideCar: () => Boolean(this.life?.carAt(this.camera.position.x, this.camera.position.y, this.camera.position.z, 0)),
      lanesAhead: (seconds: number) => this.life?.lanesAhead(seconds) ?? [],
      prompt: () => this.prompt,
      board: (id: string) => this.board(id),
      requestStop: () => this.requestStop(),
      junctions: () => this.world.junctionSigns,
      stops: () => STOPS.map(({ route, ...stop }) => ({ ...stop, routeId: route.routeId })),
      places: () => PLACES.map((place) => ({ id: place.id, name: place.name, kind: place.kind, door: place.door, kerb: place.kerb })),
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
      gpu: () => ({
        lost: (this.engine as unknown as { _gl: WebGLRenderingContext })._gl.isContextLost(),
        textures: this.scene.textures.length,
        cached: this.engine.getLoadedTexturesCache().length,
        materials: this.scene.materials.length,
        meshes: this.scene.meshes.length,
        geometries: this.scene.geometries.length,
        frames: this.engine.frameId,
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
      remoteAppearances: () =>
        Object.fromEntries([...this.remotes].map(([sessionId, remote]) => [remote.tag.textContent ?? sessionId, remote.avatar?.appearance ?? null])),
    };
    (window as unknown as { __lagos: typeof hooks }).__lagos = hooks;
  }

  private assertLive() {
    if (this.disposed) throw new EngineDisposedError();
  }

  async dispose() {
    this.disposed = true;
    window.removeEventListener("resize", this.resize);
    await this.net.disconnect().catch(() => undefined);
    this.input?.dispose();
    this.audio.dispose();
    this.life?.dispose();
    syncPlotFootprints([]);
    for (const remote of this.remotes.values()) remote.tag.remove();
    for (const tag of this.busTags.values()) tag.remove();
    for (const { tag } of this.vehicles.values()) tag.remove();
    this.engine?.stopRenderLoop();
    this.scene?.dispose();
    this.engine?.dispose();
  }
}

export { defaultBindings, defaultSettings };
