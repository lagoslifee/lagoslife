import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import {
  CABINS,
  cabinSeats,
  CONSULATE_NAME,
  EXCURSION_SEATS,
  hotelById,
  INTERIOR_ORIGIN,
  POOL_WATER,
  seatPoint,
  TRAVEL_LAYOUTS,
  type FlightPhase,
  type TravelInterior,
  type TripState,
  type Vec2,
} from "@lagos-living/shared";
import { buildExitDoor } from "./exit-door";
import type { PropLibrary } from "./props";
import { MeshBuilderBatch } from "./geometry";
import type { InteriorSpot } from "./interior";
import type { Materials } from "./materials";
import { buildAirliner } from "./airliner";
import { fitAirlinerCabin } from "./cabin-fit";
import { buildAirfield, LANDING_SHOT, TAKEOFF_SHOT, type Airfield, type FlightShot } from "./flight-scenes";
import { SignAtlas } from "./sign-atlas";

const [OX, OZ] = INTERIOR_ORIGIN;
type Rgb = [number, number, number];
type Box = { x: number; z: number; hx: number; hz: number };

const SPOT_LABELS: Record<string, string> = {
  exit: "Leave",
  reception: "Reception · ask what to do",
  counter: "Visa counter · apply for a visa",
  seats: "Sit in the waiting area",
  tickets: "Ticket desk · buy or change tickets",
  checkin: "Check-in counter",
  board: "Departures board",
  lounge: "Business lounge",
  gate: "Gate desk · board the flight",
  immigration: "Immigration desk",
  baggage: "Baggage belt · collect your bag",
  bed: "Rest on the bed",
  storage: "Wardrobe safe",
  service: "Room service phone",
  view: "Take a photo of the view",
  bar: "Order at the bar",
  photo: "Photo spot",
  dining: "Rooftop dining",
  galley: "Galley",
  loungers: "Sun loungers · towels and drinks",
  swim: "Swim · walk into the water",
  towels: "Towel desk",
};

/** Seat cushion height for seated avatars in cabins, boats and the 4×4. */
export const TRAVEL_SEAT_Y = 0.45;

export type TravelView = {
  kind: TravelInterior;
  half: Vec2;
  height: number;
  seated: boolean;
  spots: InteriorSpot[];
  collide(x: number, z: number, radius: number): Vec2;
  update(seconds: number): void;
  setTableBottles(no: number, bottles: Array<{ id: string; itemId: string }>): void;
  /** Height the player stands at here: waist-deep in the pool, otherwise the floor. */
  floor(x: number, z: number): number;
  /** Cabin only: window sky and cabin lighting for this flight phase. */
  setFlight(phase: FlightPhase, progress: number, destination: "dubai" | "lagos"): void;
  /** Cabin only: an outside view of the jet during the take-off and landing, `seconds` after departure; null in the cabin. */
  flightShot(seconds: number, destination: "dubai" | "lagos"): FlightShot | null;
  dispose(): void;
};

function glow(scene: Scene, name: string, hex: string, disposables: Array<{ dispose(): void }>) {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.emissiveColor = Color3.FromHexString(hex);
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  disposables.push(material);
  return material;
}

/** A text board drawn on a canvas texture (departures, signs, notices). */
function board(scene: Scene, name: string, width: number, height: number, lines: Array<{ text: string; colour?: string; size?: number }>, background: string, disposables: Array<{ dispose(): void }>) {
  const texture = new DynamicTexture(name, { width: 512, height: Math.round((512 * height) / width) }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  const h = texture.getSize().height;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 512, h);
  let y = 0;
  for (const line of lines) {
    const size = line.size ?? 28;
    y += size + 10;
    ctx.fillStyle = line.colour ?? "#ffffff";
    let fit = size;
    do ctx.font = `bold ${fit}px Inter, Arial, sans-serif`;
    while (ctx.measureText(line.text).width > 512 - 36 && --fit > 10);
    ctx.fillText(line.text, 18, y);
  }
  texture.update(true);
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.emissiveTexture = texture;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  const plane = MeshBuilder.CreatePlane(name, { width, height }, scene);
  plane.material = material;
  disposables.push(texture, material, plane);
  return plane;
}

/** Builds one travel interior at the interior origin, in the same shape as a home interior view. */
export function buildTravelInterior(scene: Scene, materials: Materials, atlas: SignAtlas, kind: TravelInterior, trip: TripState | null, props: PropLibrary | null = null): TravelView {
  const layout = TRAVEL_LAYOUTS[kind];
  const [HX, HZ] = layout.half;
  const open = kind === "rooftop" || kind === "dhow" || kind === "safari" || kind === "pool";
  const height = kind === "airport-los" || kind === "airport-dxb" ? 6.5 : kind === "cabin" ? 2.35 : 3.2;
  const batches = new Map<string, MeshBuilderBatch>();
  const get = (key: string) => {
    let batch = batches.get(key);
    if (!batch) {
      batch = new MeshBuilderBatch(`travel ${key}`);
      batches.set(key, batch);
    }
    return batch;
  };
  const boxes: Box[] = [];
  const disposables: Array<{ dispose(): void }> = [];
  const meshes: Mesh[] = [];
  const P = (x: number, z: number): Vec2 => [OX + x, OZ + z];
  const solid = (key: string, x: number, y: number, z: number, w: number, h: number, d: number, color?: Rgb, collide = true) => {
    get(key).box(OX + x, y, OZ + z, w, h, d, 0, 1, color);
    if (collide && y - h / 2 < 1) boxes.push({ x: OX + x, z: OZ + z, hx: w / 2, hz: d / 2 });
  };
  const deco = (key: string, x: number, y: number, z: number, w: number, h: number, d: number, color?: Rgb) => get(key).box(OX + x, y, OZ + z, w, h, d, 0, 1, color);
  const spots: InteriorSpot[] = Object.entries(layout.spots).map(([id, offset]) => ({ id: id as InteriorSpot["id"], point: P(offset[0], offset[1]), label: SPOT_LABELS[id] ?? id }));
  const sign = (title: string, subtitle: string, x: number, y: number, z: number, width: number, facing: "south" | "north" | "east" | "west" = "south") => {
    const uv = atlas.get(title, "plate", subtitle);
    const h = width / SignAtlas.aspect;
    const batch = new MeshBuilderBatch(`travel sign ${title}`);
    const cx = OX + x;
    const cz = OZ + z;
    const uvs: [[number, number], [number, number], [number, number], [number, number]] = [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]];
    // Normal and the reader's right-hand direction for each facing.
    const [normal, right]: [[number, number, number], [number, number]] =
      facing === "south" ? [[0, 0, -1], [1, 0]] : facing === "north" ? [[0, 0, 1], [-1, 0]] : facing === "east" ? [[1, 0, 0], [0, 1]] : [[-1, 0, 0], [0, -1]];
    const lx = cx - (right[0] * width) / 2;
    const lz = cz - (right[1] * width) / 2;
    const rx = cx + (right[0] * width) / 2;
    const rz = cz + (right[1] * width) / 2;
    batch.quad([lx, y, lz], [rx, y, rz], [rx, y + h, rz], [lx, y + h, lz], normal, uvs);
    const mesh = batch.build(scene, atlas.material);
    if (mesh) meshes.push(mesh);
  };

  // Shell: floor, ceiling and four walls (open-air scenes get a floor and railings instead).
  const corners: Vec2[] = [P(-HX, -HZ), P(HX, -HZ), P(HX, HZ), P(-HX, HZ)];
  const floorColour: Rgb =
    kind === "consulate" ? [0.9, 0.88, 0.82] : kind === "hotel" ? [0.62, 0.5, 0.38] : kind === "cabin" ? [0.3, 0.33, 0.42] : kind === "rooftop" ? [0.72, 0.66, 0.58] : kind === "pool" ? [0.86, 0.8, 0.7] : kind === "dhow" ? [0.55, 0.36, 0.2] : kind === "safari" ? [0.25, 0.25, 0.24] : [0.86, 0.86, 0.84];
  const [wx0, wz0, wx1, wz1] = POOL_WATER;
  if (kind === "pool") {
    // Deck tiles round the pool, leaving the water open.
    for (const [x0, z0, x1, z1] of [[-HX, -HZ, HX, wz0], [-HX, wz1, HX, HZ], [-HX, wz0, wx0, wz1], [wx1, wz0, HX, wz1]] as const) {
      get("tiles").polygon([P(x0, z0), P(x1, z0), P(x1, z1), P(x0, z1)], 0.02, 1.4, floorColour);
    }
  } else if (kind !== "dhow" && kind !== "safari" && kind !== "cabin") get(kind === "hotel" ? "fabric" : "tiles").polygon(corners, 0.02, 1.4, floorColour);
  if (kind === "cabin") {
    // Round fuselage: an elliptical tube seen from inside, closed at both ends.
    const shell = new StandardMaterial("cabin shell", scene);
    shell.diffuseColor = Color3.FromHexString("#f1efe9");
    shell.specularColor = new Color3(0.12, 0.12, 0.12);
    shell.emissiveColor = Color3.FromHexString("#eceae4").scale(0.22);
    shell.backFaceCulling = false;
    disposables.push(shell);
    const tube = MeshBuilder.CreateCylinder("cabin fuselage", { diameter: 4.0, height: HZ * 2, tessellation: 36, cap: Mesh.NO_CAP }, scene);
    tube.rotation.x = Math.PI / 2;
    tube.scaling.z = 0.9;
    tube.position.set(OX, 0.55, OZ);
    tube.material = shell;
    tube.isPickable = false;
    disposables.push(tube);
    for (const end of [-1, 1]) {
      const cap = MeshBuilder.CreateDisc("cabin end", { radius: 2.0, tessellation: 36 }, scene);
      cap.scaling.y = 0.9;
      cap.position.set(OX, 0.55, OZ + end * HZ);
      cap.material = shell;
      cap.isPickable = false;
      disposables.push(cap);
    }
  } else if (!open) {
    get("plaster").polygon(corners, height, 3, [0.97, 0.97, 0.96], true);
    const wall: Rgb = kind === "consulate" ? [0.93, 0.9, 0.84] : kind === "hotel" ? [0.95, 0.92, 0.86] : [0.9, 0.92, 0.94];
    const terminal = kind === "airport-los" || kind === "airport-dxb";
    for (let index = 0; index < 4; index += 1) {
      // Terminals glaze the north side onto the apron instead of walling it.
      if (terminal && index === 2) continue;
      const a = corners[index]!;
      const b = corners[(index + 1) % 4]!;
      get("plaster").wall(b[0], b[1], a[0], a[1], 0, height, 2.5, wall);
    }
  }
  const exit = layout.spots.exit;
  if (exit) {
    const label = kind === "airport-dxb" ? "Taxis · car hire · Dubai" : kind === "airport-los" ? "Out to Lagos" : kind === "hotel" ? "Corridor · lift" : kind === "consulate" ? "Back to the street" : "Way out";
    buildExitDoor(scene, OX + exit[0], OZ + (open ? exit[1] - 0.6 : -HZ + 0.02), 0, disposables, { label, freestanding: open, width: kind.startsWith("airport") ? 2.4 : 1.8 });
  }

  let animate: (seconds: number) => void = () => {};
  let setFlight: TravelView["setFlight"] = () => {};
  let flightShot: TravelView["flightShot"] = () => null;
  const lights: Array<PointLight | HemisphericLight> = [];
  const light = (x: number, y: number, z: number, hex: string, intensity: number, range: number) => {
    const point = new PointLight(`travel light ${lights.length}`, new Vector3(OX + x, y, OZ + z), scene);
    point.diffuse = Color3.FromHexString(hex);
    point.intensity = intensity;
    point.range = range;
    lights.push(point);
    return point;
  };

  if (kind === "consulate") {
    sign(CONSULATE_NAME.split(" — ")[0]!, "Game roleplay · fictional office", 0, 2.1, HZ - 0.03, 4.2);
    // Reception desk, waiting seats, the glazed visa counter, flags and a notice board.
    solid("wood", -4, 0.55, -1.5, 2.4, 1.1, 0.7, [0.55, 0.38, 0.24]);
    deco("chrome", -4, 1.12, -1.5, 2.5, 0.04, 0.8, [0.85, 0.85, 0.82]);
    for (let row = 0; row < 2; row += 1) {
      for (let seat = 0; seat < 4; seat += 1) {
        const x = -4.4 + seat * 0.65;
        const z = 1.2 + row * 1.3;
        solid("fabric", x, 0.25, z, 0.55, 0.45, 0.5, [0.2, 0.35, 0.5]);
        deco("fabric", x, 0.65, z + 0.24, 0.55, 0.5, 0.08, [0.2, 0.35, 0.5]);
      }
    }
    solid("wood", 2.6, 0.55, 4.4, 4.4, 1.1, 0.7, [0.45, 0.32, 0.22]);
    get("glass").box(OX + 2.6, 1.7, OZ + 4.1, 4.4, 1.2, 0.04);
    for (const x of [0.6, 2.6, 4.6]) deco("frame", x, 1.7, 4.1, 0.05, 1.2, 0.06);
    sign("Visa counter", "Apply · pay · collect", 2.6, 2.4, 4.0, 2.2);
    sign("Reception", "Ask here first", -4, 1.9, -1.1, 1.6);
    for (const [x, colour] of [[-6.6, [0.0, 0.45, 0.2]], [6.6, [0.75, 0.05, 0.1]]] as const) {
      deco("pole", x, 1.2, 4.9, 0.05, 2.4, 0.05);
      deco("fabric", x + (x < 0 ? 0.35 : -0.35), 2.1, 4.9, 0.7, 0.45, 0.02, colour as Rgb);
    }
    const notice = board(scene, "consulate notice", 2.4, 1.2, [
      { text: "HOW TO APPLY", colour: "#ffd27a", size: 30 },
      { text: "1  Choose a 14-day or 30-day visa", size: 22 },
      { text: "2  Pay the fee at the counter", size: 22 },
      { text: "3  Wait a few seconds in the seats", size: 22 },
      { text: "Fictional roleplay office.", colour: "#9fd3ff", size: 20 },
      { text: "No real documents are issued.", colour: "#9fd3ff", size: 20 },
    ], "#1c2a3a", disposables);
    notice.position.set(OX - HX + 0.03, 1.7, OZ + 2);
    notice.rotation.y = -Math.PI / 2;
    light(0, height - 0.3, 0, "#fff3e0", 16, 16);
  } else if (kind === "airport-los" || kind === "airport-dxb") {
    const dubai = kind === "airport-dxb";
    const accent: Rgb = dubai ? [0.78, 0.62, 0.32] : [0.05, 0.45, 0.25];
    // Glass curtain wall to the apron on the north side, with a parked jet beyond.
    const clear = new StandardMaterial("terminal glass", scene);
    clear.diffuseColor = Color3.FromHexString("#bfe3f2");
    clear.specularColor = new Color3(0.9, 0.9, 0.9);
    clear.alpha = 0.16;
    clear.backFaceCulling = false;
    const curtain = MeshBuilder.CreatePlane("terminal curtain wall", { width: HX * 2, height: height - 0.42 }, scene);
    curtain.position.set(OX, 0.02 + (height - 0.42) / 2, OZ + HZ - 0.03);
    curtain.material = clear;
    curtain.isPickable = false;
    disposables.push(clear, curtain);
    for (let x = -HX + 2; x < HX; x += 2.5) deco("frame", x, height / 2, HZ - 0.06, 0.08, height, 0.08);
    const apron = glow(scene, "apron sky", dubai ? "#f2d7a8" : "#bcd9ef", disposables);
    const sky = MeshBuilder.CreatePlane("apron view", { width: 400, height: 80 }, scene);
    sky.position.set(OX, 30, OZ + HZ + 80);
    sky.material = apron;
    disposables.push(sky);
    deco("concrete", 0, 0.0, HZ + 40, 400, 0.05, 80, [0.55, 0.55, 0.55]);
    for (const x of [-9, 9]) deco("paintWhite", x, 0.04, HZ + 22, 0.25, 0.02, 40, [0.95, 0.85, 0.2]);
    const jet = buildAirliner(scene, "parked airliner", { accent: dubai ? "#b8913c" : "#0d7a3e", title: "NAIJA WORLD AIR" });
    jet.root.position.x = OX;
    jet.root.position.z = OZ + HZ + 22;
    disposables.push(jet);
    // Jet bridge from the gate to the forward door.
    deco("darkFrame", layout.spots.gate![0], 3.2, HZ + 1.6, 2.4, 2.6, 3.2, [0.4, 0.42, 0.45]);
    deco("glass", layout.spots.gate![0], 3.2, HZ + 1.6, 2.5, 1.0, 2.6);
    // Ticket desk and check-in counters on the west side; gate desk at the jet bridge.
    const tz = layout.spots.tickets![1];
    const cz = layout.spots.checkin![1];
    solid("wood", -14.2, 0.55, tz, 1.2, 1.1, 3.2, accent);
    sign("Tickets", "Lagos ⇄ Dubai · LL 721 / 722", -14.7, 2.0, -3.5, 2.6, "east");
    if (props?.has("checkin-counter")) {
      props.place("checkin-counter", OX - 14.2, OZ + cz, -Math.PI / 2, disposables);
      boxes.push({ x: OX - 14.2, z: OZ + cz, hx: 0.6, hz: 2.4 });
    } else {
      for (const z of [0.8, 2.5, 4.2]) {
        solid("concrete", -14.2, 0.55, z, 1.2, 1.1, 1.2, [0.85, 0.86, 0.88]);
        deco("rubber", -13.4, 0.35, z, 0.6, 0.12, 1.1);
      }
    }
    sign("Check-in", "Economy · Business priority", -14.7, 2.0, 2.5, 2.6, "east");
    // Counter tops and staff monitors facing the agents' side of each desk.
    const monitors = (z: number) => {
      deco("darkFrame", -14.45, 1.32, z, 0.05, 0.32, 0.42, [0.08, 0.08, 0.1]);
      deco("chrome", -14.45, 1.14, z, 0.18, 0.04, 0.12, [0.3, 0.3, 0.32]);
    };
    deco("chrome", -14.15, 1.12, tz, 1.35, 0.04, 3.3, [0.9, 0.88, 0.84]);
    for (const dz of [-1, 0, 1]) monitors(tz + dz);
    if (!props?.has("checkin-counter")) {
      for (const z of [0.8, 2.5, 4.2]) {
        deco("chrome", -14.15, 1.12, z, 1.35, 0.04, 1.25, [0.9, 0.88, 0.84]);
        monitors(z);
        deco("darkFrame", -13.75, 1.6, z + 0.4, 0.04, 0.3, 0.42, [0.05, 0.05, 0.07]);
      }
    }
    const [gx] = layout.spots.gate!;
    solid("concrete", gx, 0.55, 9.4, 2.6, 1.1, 0.7, accent);
    sign(dubai ? "Gate B7" : "Gate 3", dubai ? "LL 722 to Lagos" : "LL 721 to Dubai", gx, 2.5, HZ - 0.2, 2.4);
    // Departures board facing the entrance.
    const flights = board(scene, "departures", 6, 2, [
      { text: dubai ? "DEPARTURES · DXB" : "DEPARTURES · LOS", colour: "#ffd23a", size: 30 },
      { text: dubai ? "LL 722  LAGOS       BOARDING" : "LL 721  DUBAI       BOARDING", size: 26 },
      { text: dubai ? "LL 722  LAGOS       NEXT 10s" : "LL 721  DUBAI       NEXT 10s", size: 26 },
      { text: "Check in · then gate · 60 s flight", colour: "#9fd3ff", size: 22 },
    ], "#0b0f18", disposables);
    flights.position.set(OX - 4, 3.6, OZ - 5.52);
    deco("darkFrame", -4, 3.6, -5.45, 6.2, 2.2, 0.08);
    // Overhead wayfinding: yellow-on-navy boards hung from the ceiling, numbered in the order you use them.
    const hang = (name: string, x: number, z: number, width: number, lines: Array<{ text: string; colour?: string; size?: number }>, facing: "south" | "north" | "east") => {
      const panel = board(scene, name, width, 1.1, lines, "#0d1b3d", disposables);
      panel.position.set(OX + x, 4.3, OZ + z);
      panel.rotation.y = facing === "south" ? 0 : facing === "north" ? Math.PI : -Math.PI / 2;
      const along = facing === "east";
      deco("darkFrame", along ? x - 0.04 : x, 4.3, along ? z : facing === "south" ? z + 0.04 : z - 0.04, along ? 0.06 : width + 0.12, 1.22, along ? width + 0.12 : 0.06);
      for (const side of [-1, 1]) {
        const offset = side * (width / 2 - 0.3);
        deco("chrome", along ? x : x + offset, (4.85 + height) / 2, along ? z + offset : z, 0.04, height - 4.85, 0.04);
      }
    };
    const Y = "#ffd23a";
    hang("sign tickets", -13.6, tz, 3.2, [{ text: "1  TICKETS", colour: Y, size: 40 }, { text: "Buy here · staff hand you the pass", size: 20 }], "east");
    hang("sign checkin", -13.6, cz + 0.8, 3.2, [{ text: "2  CHECK-IN", colour: Y, size: 40 }, { text: "Bag drop · boarding pass", size: 20 }], "east");
    hang("sign gate", gx, 7.6, 3.2, [{ text: `3  GATE ${dubai ? "B7" : "3"}`, colour: Y, size: 40 }, { text: "Show pass · board the aircraft", size: 20 }], "south");
    const [lx0, lz0] = layout.spots.lounge!;
    hang("sign lounge", lx0, lz0 - 2.6, 3.2, [{ text: "BUSINESS LOUNGE", colour: Y, size: 34 }, { text: "Sit down · staff bring your order", size: 20 }], "south");
    const loungeArrow = lx0 < 0 ? "← BUSINESS LOUNGE" : "BUSINESS LOUNGE →";
    if (dubai) {
      const [sx, sz] = layout.spawn;
      hang("sign arrivals", sx, sz - 2.2, 6, [
        { text: "ARRIVALS  ↑ IMMIGRATION  ↑ BAGGAGE", colour: Y, size: 24 },
        { text: "↑ EXIT · TAXI TO HOTEL · CAR HIRE", size: 20 },
      ], "north");
    }
    if (dubai) {
      hang("sign exit", 0, -7.12, 7, [
        { text: "↑ EXIT · TAXI TO YOUR HOTEL · CAR HIRE", colour: Y, size: 22 },
        { text: "Tourism centre: safari · dhow · clubs", size: 20 },
      ], "north");
    }
    hang("sign departures", 0, -7.2, 7, [
      { text: "← 1 TICKETS   ← 2 CHECK-IN   ↑ 3 GATE", colour: Y, size: 22 },
      { text: `DEPARTURES · ${loungeArrow}`, size: 20 },
    ], "south");
    // Business lounge with sofas behind a low screen.
    const [lx, lz] = layout.spots.lounge!;
    get("fabric").polygon([P(lx - 3, lz - 2.2), P(lx + 3, lz - 2.2), P(lx + 3, lz + 2.2), P(lx - 3, lz + 2.2)], 0.03, 1, [0.35, 0.12, 0.15]);
    for (const dz of [-1.4, 1.4]) solid("fabric", lx + (dubai ? 1.5 : -1.5), 0.3, lz + dz, 1.8, 0.5, 0.8, [0.15, 0.15, 0.18]);
    solid("wood", lx, 0.4, lz, 1.0, 0.5, 1.0, [0.4, 0.28, 0.18]);
    sign("Business lounge", "Business tickets", lx, 2.2, lz - 2.25, 2.2);
    // Rows of gate seating.
    for (const z of [-1, 1.5, 4]) for (let x = -7; x <= 6; x += 0.62) if (Math.abs(x + 4) > 1.2 || z > 0) deco("fabric", x, 0.45, z, 0.56, 0.08, 0.52, [0.2, 0.25, 0.3]);
    for (const z of [-1, 1.5, 4]) boxes.push({ x: OX - 0.5, z: OZ + z, hx: 6.8, hz: 0.3 });
    if (dubai) {
      // Fictional immigration booths, a baggage carousel and arrivals signage.
      const [ix, iz] = layout.spots.immigration!;
      for (const dx of [-2.6, 0, 2.6]) {
        if (props?.has("immigration-booth")) {
          props.place("immigration-booth", OX + ix + dx, OZ + iz + 0.6, Math.PI, disposables);
          boxes.push({ x: OX + ix + dx, z: OZ + iz + 0.6, hx: 1.05, hz: 1.05 });
        } else {
          solid("wood", ix + dx, 0.6, iz + 1.2, 1.4, 1.2, 1.0, [0.86, 0.8, 0.7]);
          get("glass").box(OX + ix + dx, 1.6, OZ + iz + 1.2, 1.4, 0.8, 0.04);
        }
      }
      sign("Immigration", "Fictional · game roleplay", ix, 2.6, iz + 1.8, 2.6);
      hang("sign immigration", ix, iz - 1.0, 6, [{ text: "A  IMMIGRATION", colour: Y, size: 40 }, { text: "All arrivals start here · passport control", size: 20 }], "north");
      hang("sign baggage", layout.spots.baggage![0] - 0.6, layout.spots.baggage![1] + 3.4, 3.4, [{ text: "B  BAGGAGE", colour: Y, size: 40 }, { text: "After immigration · then EXIT", size: 20 }], "north");
      const [bx, bz] = layout.spots.baggage!;
      solid("chrome", bx + 1.4, 0.35, bz, 1.4, 0.7, 5.5, [0.45, 0.47, 0.5]);
      const belt = MeshBuilder.CreateBox("baggage belt", { width: 1.1, height: 0.05, depth: 5.2 }, scene);
      belt.position.set(OX + bx + 1.4, 0.72, OZ + bz);
      belt.material = materials.rubber;
      disposables.push(belt);
      const bags = new TransformNode("bags", scene);
      for (let index = 0; index < 5; index += 1) {
        const bag = MeshBuilder.CreateBox(`bag ${index}`, { width: 0.5, height: 0.32, depth: 0.7 }, scene);
        bag.material = [materials.fabric, materials.awningRed, materials.darkFrame][index % 3]!;
        bag.position.set(OX + bx + 1.4, 0.92, OZ + bz - 2.4 + index * 1.1);
        bag.parent = bags;
      }
      disposables.push(bags);
      sign("Baggage reclaim", "LL 721 from Lagos", HX - 0.05, 2.4, bz, 2.2, "west");
      sign("Welcome to Dubai", "Arrivals · taxis · car hire →", 0, 3.4, -HZ + 0.04, 4.2, "north");
      animate = (seconds) => {
        bags.getChildren().forEach((child, index) => {
          const node = child as Mesh;
          node.position.z = OZ + bz - 2.6 + ((index * 1.1 + seconds * 0.5) % 5.2);
        });
      };
    } else {
      sign("Murtala Muhammed Terminal", "Naija World Air · fictional", 0, 3.4, -HZ + 0.04, 4.2, "north");
    }
    for (const x of [-8, 8]) light(x, height - 0.4, 0, "#fff6e8", 22, 22).excludedMeshes.push(...jet.meshes);
  } else if (kind === "cabin") {
    const windowMaterial = glow(scene, "cabin windows", "#9fc8ef", disposables);
    const windows = new MeshBuilderBatch("cabin windows");
    fitAirlinerCabin(get, windows, HZ);
    const windowMesh = windows.build(scene, windowMaterial);
    if (windowMesh) disposables.push(windowMesh);
    // Cove lights along the top of the bins, washing the ceiling in the cabin mood colour.
    const cabinStrip = glow(scene, "cabin mood light", "#c8b8ff", disposables);
    for (const side of [-1, 1]) {
      const strip = MeshBuilder.CreateBox("cabin strip", { width: 0.03, height: 0.02, depth: HZ * 2 - 2 }, scene);
      strip.position.set(OX + side * 0.84, 2.18, OZ - 0.12);
      strip.material = cabinStrip;
      strip.isPickable = false;
      disposables.push(strip);
    }
    sign("Business", CABINS.business.seat, 0, 1.92, 4.05, 1.0, "south");
    sign("Galley", "Naija World Air", 0, 1.95, HZ - 0.68, 1.0);
    const cabinLight = light(0, 1.75, -0.5, "#fff4e2", 8, 22);
    const rear = light(0, 1.75, -7.5, "#fff4e2", 8, 22);
    const front = light(0, 1.75, 7, "#fff4e2", 8, 22);
    const skies: Record<FlightPhase, string> = { boarding: "#b8c9d6", takeoff: "#8fc0ec", cruise: "#3f7fd0", descent: "#f0b878", landed: "#c9d7e2" };
    setFlight = (phase, progress, destination) => {
      const colour = Color3.FromHexString(destination === "lagos" && phase === "descent" ? "#9ccf9a" : skies[phase]);
      const fade = phase === "takeoff" ? Math.min(1, progress * 3) : 1;
      windowMaterial.emissiveColor = colour.scale(0.55 + 0.45 * fade);
      const dim = phase === "takeoff" || phase === "descent";
      cabinLight.intensity = rear.intensity = front.intensity = dim ? 3 : 8;
      cabinStrip.emissiveColor = Color3.FromHexString(dim ? "#5b4cc8" : phase === "cruise" ? "#e8d9ff" : "#c8b8ff");
    };
    // Departure and arrival airfields are built only around their shots, far from everything else.
    let field: { airfield: Airfield; airport: "los" | "dxb" } | null = null;
    const fieldFor = (airport: "los" | "dxb") => {
      if (field?.airport === airport) return field.airfield;
      field?.airfield.dispose();
      field = { airfield: buildAirfield(scene, [OX, OZ + 3_000], airport), airport };
      return field.airfield;
    };
    disposables.push({ dispose: () => field?.airfield.dispose() });
    flightShot = (seconds, destination) => {
      const from = destination === "dubai" ? "los" : "dxb";
      const to = destination === "dubai" ? "dxb" : "los";
      if (seconds >= TAKEOFF_SHOT[0] - 6 && seconds < TAKEOFF_SHOT[0]) {
        fieldFor(from);
        return null;
      }
      if (seconds >= TAKEOFF_SHOT[0] && seconds < TAKEOFF_SHOT[1]) return fieldFor(from).takeoff(seconds - TAKEOFF_SHOT[0]);
      if (seconds >= LANDING_SHOT[0] - 3 && seconds < LANDING_SHOT[1]) {
        const airfield = fieldFor(to);
        return seconds >= LANDING_SHOT[0] ? airfield.landing(seconds - LANDING_SHOT[0]) : null;
      }
      if (field) {
        field.airfield.dispose();
        field = null;
      }
      return null;
    };
  } else if (kind === "hotel") {
    const hotel = trip?.room ? hotelById.get(trip.room.hotelId) : undefined;
    const tier = hotel?.tier ?? "mid";
    const room = hotel?.rooms.find((entry) => entry.type === trip?.room?.roomType);
    sign(hotel?.name ?? "Hotel room", room ? `${room.name} · fictional hotel` : "Fictional hotel", -2.6, 2.2, -HZ + 0.04, 2.2, "north");
    // Big window to a marina skyline view on the north wall.
    const view = glow(scene, "hotel view", tier === "luxury" ? "#f6c58f" : "#9fd0ee", disposables);
    const pane = MeshBuilder.CreatePlane("hotel view pane", { width: HX * 2 - 1.2, height: 2.2 }, scene);
    pane.position.set(OX, 1.55, OZ + HZ - 0.04);
    pane.material = view;
    disposables.push(pane);
    for (let index = 0; index < 9; index += 1) deco("glass", -4.8 + index * 1.2, 1.1 + (index % 3) * 0.25, HZ - 0.02, 0.6, 0.9 + (index % 4) * 0.35, 0.01, [0.3, 0.45, 0.55]);
    for (let x = -HX + 0.6; x <= HX - 0.6; x += 2.2) deco("frame", x, 1.55, HZ - 0.06, 0.06, 2.2, 0.06);
    // Bed, bedside tables, sofa, desk, wardrobe with safe, rug.
    const bedX = -3.4;
    solid("wood", bedX, 0.25, 2.6, tier === "budget" ? 1.5 : 2.0, 0.4, 2.1, [0.45, 0.3, 0.2]);
    deco("bedding", bedX, 0.55, 2.6, tier === "budget" ? 1.4 : 1.9, 0.22, 2.0);
    deco("bedding", bedX, 0.72, 3.4, tier === "budget" ? 1.1 : 1.6, 0.14, 0.4, [0.85, 0.88, 0.95]);
    deco("wood", bedX, 0.9, 3.7, tier === "budget" ? 1.6 : 2.2, 1.3, 0.08, [0.35, 0.24, 0.16]);
    for (const dx of [-1.4, 1.4]) solid("wood", bedX + dx, 0.3, 3.4, 0.5, 0.6, 0.45, [0.4, 0.28, 0.18]);
    solid("wood", 5.5, 1.0, 0.4, 0.9, 2.0, 1.6, [0.5, 0.36, 0.24]);
    deco("darkFrame", 5.04, 0.6, 0.4, 0.04, 0.4, 0.5, [0.12, 0.12, 0.14]);
    deco("lamp", 5.03, 0.66, 0.5, 0.01, 0.05, 0.08);
    solid("fabric", 2.0, 0.25, 1.4, 2.0, 0.45, 0.85, tier === "luxury" ? [0.65, 0.55, 0.4] : [0.3, 0.5, 0.55]);
    deco("fabric", 2.0, 0.65, 1.0, 2.0, 0.5, 0.15, tier === "luxury" ? [0.65, 0.55, 0.4] : [0.3, 0.5, 0.55]);
    solid("wood", 2.6, 0.38, 3.6, 1.2, 0.06, 0.6, [0.42, 0.3, 0.2]);
    deco("darkFrame", 2.2, 0.48, 3.6, 0.2, 0.12, 0.1);
    get("fabric").polygon([P(-1, -1.5), P(3.5, -1.5), P(3.5, 2.6), P(-1, 2.6)], 0.035, 1, tier === "luxury" ? [0.75, 0.68, 0.55] : [0.55, 0.35, 0.3]);
    if (tier === "luxury") {
      solid("wood", -2, 0.38, -2.4, 1.6, 0.06, 1.0, [0.3, 0.2, 0.12]);
      for (const dx of [-0.6, 0.6]) deco("fabric", -2 + dx, 0.45, -3.1, 0.45, 0.5, 0.45, [0.6, 0.5, 0.35]);
    }
    light(0, height - 0.3, 0, "#ffeacc", 16, 14);
  } else if (kind === "rooftop") {
    // Deck, glass balustrade, bar, dining tables, photo frame, and towers all round.
    for (const [x0, z0, x1, z1] of [[-HX, -HZ, HX, -HZ], [HX, -HZ, HX, HZ], [HX, HZ, -HX, HZ], [-HX, HZ, -HX, -HZ]] as const) {
      get("glass").wall(OX + x0, OZ + z0, OX + x1, OZ + z1, 0, 1.1, 2, [0.6, 0.8, 0.85]);
      get("chrome").box(OX + (x0 + x1) / 2, 1.12, OZ + (z0 + z1) / 2, Math.max(0.05, Math.abs(x1 - x0)), 0.05, Math.max(0.05, Math.abs(z1 - z0)));
    }
    get("plaster").polygon([P(-HX - 40, -HZ - 40), P(HX + 40, -HZ - 40), P(HX + 40, HZ + 40), P(-HX - 40, HZ + 40)], -60, 8, [0.4, 0.42, 0.45]);
    solid("darkFrame", -7.2, 0.55, 0, 0.7, 1.1, 4.0, [0.12, 0.1, 0.1]);
    deco("chrome", -7.2, 1.12, 0, 0.8, 0.04, 4.1, [0.85, 0.72, 0.45]);
    sign("Skyline Rooftop Lounge", "Fictional venue · 48th floor", -8.9, 1.6, 0, 2.6, "east");
    for (const [x, z] of [[3.5, 1], [6, 1], [3.5, 3.5], [6, 3.5], [3.5, -1.5], [6, -1.5]] as const) {
      solid("wood", x, 0.74, z, 0.9, 0.06, 0.9, [0.85, 0.82, 0.75]);
      for (const dx of [-0.6, 0.6]) deco("fabric", x + dx, 0.45, z, 0.4, 0.5, 0.4, [0.9, 0.9, 0.88]);
    }
    deco("frame", -1.2, 1.3, 6.4, 0.08, 2.6, 0.08);
    deco("frame", 1.2, 1.3, 6.4, 0.08, 2.6, 0.08);
    deco("frame", 0, 2.6, 6.4, 2.48, 0.08, 0.08);
    sign("Photo spot", "Dubai Marina skyline", 0, 2.7, 6.35, 1.6);
    const tower = new MeshBuilderBatch("rooftop towers");
    for (let index = 0; index < 22; index += 1) {
      const angle = (index / 22) * Math.PI * 2;
      const distance = 40 + (index % 4) * 14;
      const h = 40 + ((index * 37) % 90);
      tower.box(OX + Math.cos(angle) * distance, h / 2 - 50, OZ + Math.sin(angle) * distance, 10 + (index % 3) * 4, h, 10 + (index % 2) * 5);
    }
    const towers = tower.build(scene, (materials as unknown as Record<string, Mesh["material"]>).curtainWall ?? materials.glass);
    if (towers) disposables.push(towers);
    light(0, 3, 0, "#ffd9a8", 10, 20);
    for (const x of [-6, 0, 6]) {
      const bulb = MeshBuilder.CreateSphere("string light", { diameter: 0.12 }, scene);
      bulb.position.set(OX + x, 2.6, OZ);
      bulb.material = glow(scene, "string bulb", "#ffd27a", disposables);
      disposables.push(bulb);
    }
  } else if (kind === "pool") {
    const hotel = trip?.room ? hotelById.get(trip.room.hotelId) : undefined;
    // Glass balustrade, the pool (lit blue water with a tiled rim), loungers with towels and parasols, a poolside bar,
    // palms in planters and the marina towers beyond.
    for (const [x0, z0, x1, z1] of [[-HX, -HZ, HX, -HZ], [HX, -HZ, HX, HZ], [HX, HZ, -HX, HZ], [-HX, HZ, -HX, -HZ]] as const) {
      get("glass").wall(OX + x0, OZ + z0, OX + x1, OZ + z1, 0, 1.1, 2, [0.6, 0.8, 0.85]);
      get("chrome").box(OX + (x0 + x1) / 2, 1.12, OZ + (z0 + z1) / 2, Math.max(0.05, Math.abs(x1 - x0)), 0.05, Math.max(0.05, Math.abs(z1 - z0)));
    }
    get("plaster").polygon([P(-HX - 40, -HZ - 40), P(HX + 40, -HZ - 40), P(HX + 40, HZ + 40), P(-HX - 40, HZ + 40)], -30, 8, [0.4, 0.42, 0.45]);
    const water = glow(scene, "pool water", "#3fb6d9", disposables);
    water.alpha = 0.85;
    const surface = MeshBuilder.CreateGround("pool water", { width: wx1 - wx0, height: wz1 - wz0 }, scene);
    surface.position.set(OX + (wx0 + wx1) / 2, -0.25, OZ + (wz0 + wz1) / 2);
    surface.material = water;
    disposables.push(surface);
    const basin = glow(scene, "pool basin", "#1d7fa8", disposables);
    const floorMesh = MeshBuilder.CreateGround("pool floor", { width: wx1 - wx0, height: wz1 - wz0 }, scene);
    floorMesh.position.set(OX + (wx0 + wx1) / 2, -1.3, OZ + (wz0 + wz1) / 2);
    floorMesh.material = basin;
    disposables.push(floorMesh);
    for (const [x0, z0, x1, z1] of [[wx0, wz0, wx1, wz0], [wx1, wz0, wx1, wz1], [wx1, wz1, wx0, wz1], [wx0, wz1, wx0, wz0]] as const) {
      get("tiles").wall(OX + x0, OZ + z0, OX + x1, OZ + z1, -1.3, 0.02, 1, [0.55, 0.78, 0.86]);
      deco("concrete", (x0 + x1) / 2, 0.05, (z0 + z1) / 2, Math.max(0.3, Math.abs(x1 - x0) + 0.3), 0.06, Math.max(0.3, Math.abs(z1 - z0) + 0.3), [0.95, 0.94, 0.9]);
    }
    for (const x of [-5.4, -3.6, -1.8, 0, 1.8, 3.6, 5.4]) {
      deco("chrome", x, 0.2, -4.2, 0.7, 0.06, 1.9, [0.95, 0.95, 0.93]);
      deco("fabric", x, 0.25, -4.1, 0.6, 0.04, 1.6, [0.92, 0.45, 0.2]);
      deco("fabric", x, 0.45, -4.95, 0.6, 0.35, 0.08, [0.95, 0.95, 0.93]);
      if (Math.round(x / 1.8) % 2 === 0) {
        deco("pole", x + 0.9, 1.2, -4.6, 0.05, 2.4, 0.05);
        deco("fabric", x + 0.9, 2.4, -4.6, 1.8, 0.06, 1.8, [0.95, 0.92, 0.84]);
      }
    }
    solid("wood", -7.9, 0.55, 3.6, 0.7, 1.1, 3.2, [0.45, 0.32, 0.22]);
    deco("chrome", -7.9, 1.12, 3.6, 0.8, 0.04, 3.3, [0.85, 0.75, 0.5]);
    sign("Pool bar", "Drinks to your lounger", -8.95, 1.7, 3.6, 2.2, "east");
    solid("wood", 7.4, 0.5, -5.2, 1.2, 1.0, 0.6, [0.6, 0.45, 0.3]);
    for (let index = 0; index < 4; index += 1) deco("fabric", 7.1 + index * 0.2, 1.08, -5.2, 0.18, 0.14, 0.4, [0.97, 0.97, 0.95]);
    sign("Towels", "Ask the attendant", 7.4, 1.7, -5.55, 1.4);
    sign(hotel?.name ?? "Hotel pool", "Pool deck · guests only · fictional hotel", 0, 1.5, HZ - 0.05, 3.0);
    for (const [x, z] of [[-8, -6], [8, 6], [-8, 6], [8, 0.8]] as const) {
      solid("concrete", x, 0.35, z, 0.8, 0.7, 0.8, [0.8, 0.76, 0.7]);
      deco("wood", x, 1.8, z, 0.18, 2.4, 0.18, [0.45, 0.32, 0.2]);
      for (const angle of [0, 1.3, 2.6, 3.9, 5.2]) deco("fabric", x + Math.cos(angle) * 0.6, 3.0, z + Math.sin(angle) * 0.6, 1.2, 0.05, 0.35, [0.2, 0.5, 0.22]);
    }
    const tower = new MeshBuilderBatch("pool towers");
    for (let index = 0; index < 18; index += 1) {
      const angle = (index / 18) * Math.PI * 2;
      const distance = 45 + (index % 4) * 12;
      const h = 30 + ((index * 41) % 80);
      tower.box(OX + Math.cos(angle) * distance, h / 2 - 20, OZ + Math.sin(angle) * distance, 10 + (index % 3) * 4, h, 10 + (index % 2) * 5);
    }
    const towers = tower.build(scene, (materials as unknown as Record<string, Mesh["material"]>).curtainWall ?? materials.glass);
    if (towers) disposables.push(towers);
    lights.push(new HemisphericLight("pool sun", new Vector3(0.2, 1, 0.3), scene));
    lights[lights.length - 1]!.intensity = 0.55;
    animate = (seconds) => {
      water.emissiveColor.set(0.22 + Math.sin(seconds * 1.7) * 0.03, 0.68 + Math.sin(seconds * 1.3) * 0.04, 0.85);
    };
  } else if (kind === "dhow") {
    // Wooden hull and deck with benches, a canopy, and the marina sliding past.
    get("wood").polygon([P(-HX, -HZ + 1), P(HX, -HZ + 1), P(HX, HZ - 1.5), P(0, HZ), P(-HX, HZ - 1.5)], 0.25, 1, [0.55, 0.36, 0.2]);
    for (const side of [-1, 1]) {
      deco("wood", side * HX, 0.55, 0, 0.12, 0.6, HZ * 2 - 1.5, [0.45, 0.28, 0.15]);
      for (const seat of EXCURSION_SEATS.dhow.filter((entry) => Math.sign(entry.at[0]) === side)) deco("wood", seat.at[0] - side * 0.1, 0.3, seat.at[1], 0.45, 0.1, 1.3, [0.6, 0.42, 0.25]);
    }
    deco("fabric", 0, 2.4, -0.5, HX * 2 + 0.2, 0.05, 10, [0.85, 0.12, 0.15]);
    for (const [x, z] of [[-HX, -5], [HX, -5], [-HX, 4], [HX, 4]] as const) deco("wood", x, 1.3, z, 0.1, 2.2, 0.1);
    const sea = MeshBuilder.CreateGround("marina water", { width: 400, height: 400 }, scene);
    sea.position.set(OX, 0.0, OZ);
    sea.material = (materials as unknown as Record<string, Mesh["material"]>).gulf ?? materials.water;
    disposables.push(sea);
    const skyline = new TransformNode("marina skyline", scene);
    skyline.position.set(OX, 0, OZ);
    const towerMaterial = (materials as unknown as Record<string, Mesh["material"]>).curtainWall ?? materials.glass;
    for (let index = 0; index < 30; index += 1) {
      const side = index % 2 ? 1 : -1;
      const h = 30 + ((index * 41) % 110);
      const towerMesh = MeshBuilder.CreateBox(`marina tower ${index}`, { width: 12, height: h, depth: 12 }, scene);
      towerMesh.position.set(side * (32 + (index % 3) * 10), h / 2, -150 + index * 10);
      towerMesh.material = towerMaterial;
      towerMesh.parent = skyline;
    }
    disposables.push(skyline);
    light(0, 3, 0, "#fff0d0", 6, 14);
    animate = (seconds) => {
      skyline.position.z = OZ - ((seconds * 3) % 150) + 60;
    };
  } else if (kind === "safari") {
    // Open 4×4 on the dunes: body, roll bar and bench rows; dunes stream past and the car rocks.
    const { truck, wheels } = buildSafariTruck(scene, disposables);
    truck.position.set(OX, 0, OZ);
    const sand = (materials as unknown as Record<string, Mesh["material"]>).sand ?? materials.dirt;
    const dunes = new TransformNode("dunes", scene);
    dunes.position.set(OX, 0, OZ);
    const ground = MeshBuilder.CreateGround("desert floor", { width: 600, height: 600 }, scene);
    ground.position.set(OX, -0.05, OZ);
    ground.material = sand;
    disposables.push(ground);
    for (let index = 0; index < 40; index += 1) {
      const dune = MeshBuilder.CreateSphere(`dune ${index}`, { diameterX: 30 + (index % 5) * 8, diameterY: 8 + (index % 4) * 3, diameterZ: 20 + (index % 3) * 6, segments: 8 }, scene);
      dune.position.set(((index * 53) % 120) - 60 + (index % 2 ? 18 : -18), -1, -200 + index * 10);
      dune.material = sand;
      dune.parent = dunes;
    }
    disposables.push(dunes);
    lights.push(new HemisphericLight("desert sun", new Vector3(0.3, 1, 0.2), scene));
    lights[lights.length - 1]!.intensity = 0.4;
    animate = (seconds) => {
      dunes.position.z = OZ - ((seconds * 9) % 200) + 100;
      truck.rotation.z = Math.sin(seconds * 3.1) * 0.03;
      truck.rotation.x = Math.sin(seconds * 2.3) * 0.025;
      for (const wheel of wheels) wheel.rotation.x = seconds * 22;
    };
  }

  for (const [key, batch] of batches) {
    const material = (materials as unknown as Record<string, Mesh["material"]>)[key] ?? materials.plaster;
    const mesh = batch.build(scene, material!);
    if (mesh) meshes.push(mesh);
  }

  return {
    kind,
    half: layout.half,
    height,
    seated: kind === "cabin" || kind === "dhow" || kind === "safari",
    spots,
    collide(x: number, z: number, radius: number): Vec2 {
      let px = Math.max(OX - HX + radius, Math.min(OX + HX - radius, x));
      let pz = Math.max(OZ - HZ + radius, Math.min(OZ + HZ - radius, z));
      for (const box of boxes) {
        const dx = px - box.x;
        const dz = pz - box.z;
        const ox = box.hx + radius - Math.abs(dx);
        const oz = box.hz + radius - Math.abs(dz);
        if (ox > 0 && oz > 0) {
          if (ox < oz) px += Math.sign(dx || 1) * ox;
          else pz += Math.sign(dz || 1) * oz;
        }
      }
      return [px, pz];
    },
    update(seconds: number) {
      animate(seconds);
    },
    setTableBottles() {},
    floor(x: number, z: number) {
      if (kind !== "pool") return 0.02;
      const inside = x > OX + wx0 + 0.25 && x < OX + wx1 - 0.25 && z > OZ + wz0 + 0.25 && z < OZ + wz1 - 0.25;
      return inside ? -0.95 : 0.02;
    },
    setFlight(phase, progress, destination) {
      setFlight(phase, progress, destination);
    },
    flightShot(seconds, destination) {
      return flightShot(seconds, destination);
    },
    dispose() {
      for (const mesh of meshes) mesh.dispose();
      for (const item of disposables) item.dispose();
      for (const entry of lights) entry.dispose();
    },
  };
}

/**
 * An open safari Land Cruiser, facing +z: sand-coloured body with low sides, bonnet and grille, a dashboard with the
 * wheel on the left, windscreen, roll cage under a canvas sun shade, three rows of tan seats with backs, chunky
 * tyres and a spare on the tailgate. Seat cushions sit at the travel seat height.
 */
function buildSafariTruck(scene: Scene, disposables: Array<{ dispose(): void }>) {
  const truck = new TransformNode("safari truck", scene);
  disposables.push(truck);
  const paints = new Map<string, StandardMaterial>();
  const paint = (hex: string, alpha = 1, glow = 0) => {
    const key = `${hex}|${alpha}|${glow}`;
    let material = paints.get(key);
    if (!material) {
      material = new StandardMaterial(`safari ${key}`, scene);
      material.diffuseColor = Color3.FromHexString(hex);
      material.emissiveColor = Color3.FromHexString(hex).scale(glow);
      material.specularColor = new Color3(0.15, 0.15, 0.15);
      material.alpha = alpha;
      paints.set(key, material);
      disposables.push(material);
    }
    return material;
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, hex: string, parent: TransformNode = truck, alpha = 1, glow = 0) => {
    const mesh = MeshBuilder.CreateBox("safari part", { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.material = paint(hex, alpha, glow);
    mesh.parent = parent;
    mesh.isPickable = false;
    return mesh;
  };
  const BODY = "#d9c79f";
  const TRIM = "#2c2b28";
  const LEATHER = "#8a5a32";
  const BAR = "#3b3b38";
  box(0, 0.3, 0.1, 1.9, 0.08, 4.8, "#4a4640");
  for (const side of [-1, 1]) {
    box(side * 0.97, 0.58, -0.3, 0.06, 0.5, 3.8, BODY);
    box(side * 0.97, 0.86, -0.3, 0.09, 0.05, 3.8, TRIM);
    box(side * 1.02, 0.22, 0.1, 0.12, 0.05, 2.0, TRIM);
    for (const wz of [1.75, -1.55]) box(side * 0.98, 0.86, wz, 0.22, 0.06, 1.0, TRIM);
  }
  box(0, 0.58, -2.2, 1.9, 0.5, 0.06, BODY);
  box(0, 0.74, 2.05, 1.92, 0.42, 1.1, BODY);
  box(0, 0.96, 2.05, 1.7, 0.03, 0.9, "#cbb88f");
  box(0, 0.66, 2.62, 1.6, 0.3, 0.04, TRIM);
  for (let slot = -3; slot <= 3; slot += 1) box(slot * 0.16, 0.66, 2.645, 0.05, 0.24, 0.01, "#6d6a63");
  for (const side of [-1, 1]) box(side * 0.68, 0.7, 2.645, 0.22, 0.14, 0.02, "#fff6d8", truck, 1, 0.9);
  box(0, 0.38, 2.68, 1.94, 0.14, 0.12, TRIM);
  box(0, 0.95, 1.38, 1.84, 0.26, 0.36, TRIM);
  box(-0.45, 1.09, 1.27, 0.4, 0.1, 0.02, "#1d1d1d");
  const wheel = MeshBuilder.CreateTorus("safari steering wheel", { diameter: 0.36, thickness: 0.035, tessellation: 20 }, scene);
  wheel.position.set(-0.45, 1.06, 1.12);
  wheel.rotation.x = -1.05;
  wheel.material = paint("#1a1a1a");
  wheel.parent = truck;
  box(-0.45, 1.0, 1.22, 0.04, 0.04, 0.22, "#1a1a1a").rotation.x = -0.5;
  for (const side of [-1, 1]) box(side * 0.92, 1.38, 1.52, 0.05, 0.8, 0.05, BAR);
  box(0, 1.76, 1.52, 1.9, 0.05, 0.05, BAR);
  box(0, 1.37, 1.53, 1.8, 0.74, 0.01, "#bfe3f2", truck, 0.22);
  for (const side of [-1, 1]) {
    for (const z of [0.95, -0.95, -2.12]) box(side * 0.92, 1.4, z, 0.06, 1.1, 0.06, BAR);
    box(side * 0.92, 1.95, -0.6, 0.06, 0.06, 3.2, BAR);
  }
  for (const z of [0.95, -2.12]) box(0, 1.95, z, 1.9, 0.06, 0.06, BAR);
  box(0, 2.0, -0.6, 1.96, 0.04, 3.3, "#c2a878");
  for (const side of [-1, 1]) box(side * 0.99, 1.96, -0.6, 0.02, 0.1, 3.3, "#a88d5f");
  for (const seat of EXCURSION_SEATS.safari) {
    const [sx, sz] = seat.at;
    box(sx, 0.4, sz, 0.48, 0.1, 0.46, LEATHER);
    box(sx, 0.34, sz, 0.42, 0.1, 0.4, TRIM);
    box(sx, 0.72, sz - 0.25, 0.48, 0.56, 0.08, LEATHER);
    box(sx, 1.05, sz - 0.25, 0.26, 0.14, 0.07, LEATHER);
  }
  const wheels: TransformNode[] = [];
  for (const [x, z] of [[-0.98, 1.75], [0.98, 1.75], [-0.98, -1.55], [0.98, -1.55]] as const) {
    const pivot = new TransformNode("safari wheel", scene);
    pivot.position.set(x, 0.42, z);
    pivot.parent = truck;
    const tyre = MeshBuilder.CreateCylinder("safari tyre", { height: 0.32, diameter: 0.84, tessellation: 18 }, scene);
    tyre.rotation.z = Math.PI / 2;
    tyre.material = paint("#1b1b1b");
    tyre.parent = pivot;
    const hub = MeshBuilder.CreateCylinder("safari hub", { height: 0.33, diameter: 0.42, tessellation: 6 }, scene);
    hub.rotation.z = Math.PI / 2;
    hub.material = paint("#b9b5ad");
    hub.parent = pivot;
    wheels.push(pivot);
  }
  const spare = MeshBuilder.CreateCylinder("safari spare", { height: 0.26, diameter: 0.78, tessellation: 18 }, scene);
  spare.rotation.x = Math.PI / 2;
  spare.position.set(0, 0.85, -2.37);
  spare.material = paint("#1b1b1b");
  spare.parent = truck;
  box(0, 0.85, -2.51, 0.36, 0.36, 0.02, "#b9b5ad");
  for (const side of [-1, 1]) box(side * 0.82, 0.62, -2.24, 0.14, 0.1, 0.02, "#c0262d", truck, 1, 0.6);
  return { truck, wheels };
}
