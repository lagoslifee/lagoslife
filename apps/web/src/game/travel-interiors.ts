import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
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
  seatPoint,
  TRAVEL_LAYOUTS,
  type FlightPhase,
  type TravelInterior,
  type TripState,
  type Vec2,
} from "@lagos-living/shared";
import { MeshBuilderBatch } from "./geometry";
import type { InteriorSpot } from "./interior";
import type { Materials } from "./materials";
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
  /** Cabin only: window sky and cabin lighting for this flight phase. */
  setFlight(phase: FlightPhase, progress: number, destination: "dubai" | "lagos"): void;
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
    ctx.font = `bold ${size}px Inter, Arial, sans-serif`;
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
export function buildTravelInterior(scene: Scene, materials: Materials, atlas: SignAtlas, kind: TravelInterior, trip: TripState | null): TravelView {
  const layout = TRAVEL_LAYOUTS[kind];
  const [HX, HZ] = layout.half;
  const open = kind === "rooftop" || kind === "dhow" || kind === "safari";
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
    kind === "consulate" ? [0.9, 0.88, 0.82] : kind === "hotel" ? [0.62, 0.5, 0.38] : kind === "cabin" ? [0.3, 0.33, 0.42] : kind === "rooftop" ? [0.72, 0.66, 0.58] : kind === "dhow" ? [0.55, 0.36, 0.2] : kind === "safari" ? [0.25, 0.25, 0.24] : [0.86, 0.86, 0.84];
  if (kind !== "dhow" && kind !== "safari") get(kind === "hotel" || kind === "cabin" ? "fabric" : "tiles").polygon(corners, 0.02, kind === "cabin" ? 2 : 1.4, floorColour);
  if (!open) {
    get("plaster").polygon(corners, height, 3, [0.97, 0.97, 0.96], true);
    const wall: Rgb = kind === "consulate" ? [0.93, 0.9, 0.84] : kind === "hotel" ? [0.95, 0.92, 0.86] : kind === "cabin" ? [0.92, 0.92, 0.9] : [0.9, 0.92, 0.94];
    for (let index = 0; index < 4; index += 1) {
      const a = corners[index]!;
      const b = corners[(index + 1) % 4]!;
      get("plaster").wall(b[0], b[1], a[0], a[1], 0, height, 2.5, wall);
    }
  }
  const exit = layout.spots.exit;
  if (exit && !open) {
    get("glass").quad([OX + exit[0] + 0.9, 0.02, OZ - HZ + 0.03], [OX + exit[0] - 0.9, 0.02, OZ - HZ + 0.03], [OX + exit[0] - 0.9, 2.4, OZ - HZ + 0.03], [OX + exit[0] + 0.9, 2.4, OZ - HZ + 0.03], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    deco("darkFrame", exit[0], 2.45, -HZ + 0.05, 2, 0.1, 0.1);
  }

  let animate: (seconds: number) => void = () => {};
  let setFlight: TravelView["setFlight"] = () => {};
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
    get("glass").quad([OX - HX, 0.02, OZ + HZ - 0.03], [OX + HX, 0.02, OZ + HZ - 0.03], [OX + HX, height - 0.4, OZ + HZ - 0.03], [OX - HX, height - 0.4, OZ + HZ - 0.03], [0, 0, -1], [[0, 0], [8, 0], [8, 2], [0, 2]]);
    for (let x = -HX + 2; x < HX; x += 2.5) deco("frame", x, height / 2, HZ - 0.06, 0.08, height, 0.08);
    const apron = glow(scene, "apron sky", dubai ? "#f2d7a8" : "#bcd9ef", disposables);
    const sky = MeshBuilder.CreatePlane("apron view", { width: HX * 2 + 20, height: 30 }, scene);
    sky.position.set(OX, 10, OZ + HZ + 30);
    sky.material = apron;
    disposables.push(sky);
    deco("concrete", 0, 0.0, HZ + 14, HX * 2 + 20, 0.05, 28, [0.55, 0.55, 0.55]);
    deco("paintWhite", 0, 3.2, HZ + 14, 4.0, 3.6, 30, [0.95, 0.96, 0.97]);
    deco("paintWhite", 0, 3.6, HZ + 12, 34, 0.5, 4.0, [0.92, 0.93, 0.95]);
    deco("paintWhite", 0, 6.2, HZ + 28, 0.4, 4.5, 3.0, accent);
    deco("darkFrame", 0, 1.6, HZ + 1.5, 1.6, 3.2, 3.0, [0.4, 0.42, 0.45]);
    // Ticket desk and check-in counters on the west side; gate desk at the jet bridge.
    solid("wood", -14.2, 0.55, -3.5, 1.2, 1.1, 3.2, accent);
    sign("Tickets", "Lagos ⇄ Dubai · LL 721 / 722", -14.7, 2.0, -3.5, 2.6, "east");
    for (const z of [0.8, 2.5, 4.2]) {
      solid("concrete", -14.2, 0.55, z, 1.2, 1.1, 1.2, [0.85, 0.86, 0.88]);
      deco("rubber", -13.4, 0.35, z, 0.6, 0.12, 1.1);
    }
    sign("Check-in", "Economy · Business priority", -14.7, 2.0, 2.5, 2.6, "east");
    solid("concrete", 0, 0.55, 9.4, 2.6, 1.1, 0.7, accent);
    sign(dubai ? "Gate B7" : "Gate 3", dubai ? "LL 722 to Lagos" : "LL 721 to Dubai", 0, 2.5, HZ - 0.2, 2.4);
    // Departures board facing the entrance.
    const flights = board(scene, "departures", 6, 2, [
      { text: dubai ? "DEPARTURES · DXB" : "DEPARTURES · LOS", colour: "#ffd23a", size: 30 },
      { text: dubai ? "LL 722  LAGOS       BOARDING" : "LL 721  DUBAI       BOARDING", size: 26 },
      { text: dubai ? "LL 722  LAGOS       NEXT 10s" : "LL 721  DUBAI       NEXT 10s", size: 26 },
      { text: "Check in · then gate · 60 s flight", colour: "#9fd3ff", size: 22 },
    ], "#0b0f18", disposables);
    flights.position.set(OX - 4, 3.6, OZ - 5.5);
    flights.rotation.y = Math.PI;
    deco("darkFrame", -4, 3.6, -5.45, 6.2, 2.2, 0.08);
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
      for (const dx of [-2.4, 0, 2.4]) {
        solid("wood", ix + dx, 0.6, iz + 1.2, 1.4, 1.2, 1.0, [0.86, 0.8, 0.7]);
        get("glass").box(OX + ix + dx, 1.6, OZ + iz + 1.2, 1.4, 0.8, 0.04);
      }
      sign("Immigration", "Fictional · game roleplay", ix, 2.6, iz + 1.8, 2.6);
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
      sign("Murtala Muhammed Terminal", "Lagos Living Air · fictional", 0, 3.4, -HZ + 0.04, 4.2, "north");
    }
    light(-8, height - 0.4, 0, "#fff6e8", 22, 22);
    light(8, height - 0.4, 0, "#fff6e8", 22, 22);
  } else if (kind === "cabin") {
    // Fuselage: side walls with windows, overhead bins, an aisle runner and both cabins of seats.
    get("fabric").polygon([P(-0.38, -HZ), P(0.38, -HZ), P(0.38, HZ), P(-0.38, HZ)], 0.03, 1, [0.55, 0.12, 0.15]);
    const windowMaterial = glow(scene, "cabin windows", "#9fc8ef", disposables);
    const windows = new MeshBuilderBatch("cabin windows");
    for (let z = -HZ + 1; z < HZ - 1; z += 0.82) {
      for (const side of [-1, 1]) {
        const x = OX + side * (HX - 0.03);
        const normal: [number, number, number] = [-side, 0, 0];
        const a: [number, number, number] = [x, 1.05, OZ + z - 0.17];
        const b: [number, number, number] = [x, 1.05, OZ + z + 0.17];
        const c: [number, number, number] = [x, 1.45, OZ + z + 0.17];
        const d: [number, number, number] = [x, 1.45, OZ + z - 0.17];
        if (side > 0) windows.quad(b, a, d, c, normal, [[0, 0], [1, 0], [1, 1], [0, 1]]);
        else windows.quad(a, b, c, d, normal, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
    }
    const windowMesh = windows.build(scene, windowMaterial);
    if (windowMesh) disposables.push(windowMesh);
    for (const side of [-1, 1]) {
      deco("plaster", side * (HX - 0.3), 1.95, 0, 0.6, 0.42, HZ * 2 - 0.4, [0.9, 0.9, 0.88]);
      deco("chrome", side * (HX - 0.6), 1.75, 0, 0.02, 0.04, HZ * 2 - 0.4, [0.6, 0.6, 0.62]);
    }
    const cabinStrip = glow(scene, "cabin mood light", "#c8b8ff", disposables);
    const strip = MeshBuilder.CreateBox("cabin strip", { width: 0.06, height: 0.03, depth: HZ * 2 - 0.4 }, scene);
    strip.position.set(OX, height - 0.05, OZ);
    strip.material = cabinStrip;
    disposables.push(strip);
    const seatColour: Record<"business" | "economy", Rgb> = { business: [0.16, 0.2, 0.3], economy: [0.18, 0.3, 0.48] };
    for (const cabin of ["business", "economy"] as const) {
      const big = cabin === "business";
      for (const seat of cabinSeats(cabin)) {
        const [sx, sz] = seatPoint(seat);
        const w = big ? 0.62 : 0.42;
        get("seat").box(sx, 0.25, sz, w, 0.4, big ? 0.7 : 0.45, 0, 1, seatColour[cabin]);
        get("seat").box(sx, 0.85, sz - (big ? 0.38 : 0.24), w, big ? 0.95 : 0.8, 0.12, 0, 1, seatColour[cabin]);
        get("bedding").box(sx, 1.24, sz - (big ? 0.38 : 0.24), w * 0.7, 0.14, 0.13, 0, 1, [0.92, 0.92, 0.9]);
        if (big) get("wood").box(sx + (sx > OX ? -0.36 : 0.36), 0.55, sz, 0.12, 0.12, 0.6, 0, 1, [0.4, 0.3, 0.2]);
      }
    }
    // Bulkheads between the cabins and at the galley, with a curtain and the cabin signs.
    deco("plaster", -1.2, 1.2, 4.0, 1.4, 2.3, 0.08, [0.85, 0.84, 0.8]);
    deco("plaster", 1.2, 1.2, 4.0, 1.4, 2.3, 0.08, [0.85, 0.84, 0.8]);
    sign("Business", CABINS.business.seat, 0, 1.95, 4.05, 1.0, "south");
    deco("concrete", 0, 1.1, HZ - 0.6, HX * 2 - 0.2, 2.2, 0.9, [0.82, 0.83, 0.85]);
    sign("Galley", "Lagos Living Air", 0, 1.6, HZ - 1.06, 1.2);
    for (const z of [-HZ + 0.5]) deco("concrete", 0, 1.1, z, HX * 2 - 0.2, 2.2, 0.6, [0.82, 0.83, 0.85]);
    const cabinLight = light(0, height - 0.2, 2, "#fff4e2", 10, 22);
    const rear = light(0, height - 0.2, -7, "#fff4e2", 10, 22);
    const skies: Record<FlightPhase, string> = { boarding: "#b8c9d6", takeoff: "#8fc0ec", cruise: "#3f7fd0", descent: "#f0b878", landed: "#c9d7e2" };
    setFlight = (phase, progress, destination) => {
      const colour = Color3.FromHexString(destination === "lagos" && phase === "descent" ? "#9ccf9a" : skies[phase]);
      const fade = phase === "takeoff" ? Math.min(1, progress * 3) : 1;
      windowMaterial.emissiveColor = colour.scale(0.55 + 0.45 * fade);
      const dim = phase === "takeoff" || phase === "descent";
      cabinLight.intensity = rear.intensity = dim ? 4 : 10;
      cabinStrip.emissiveColor = Color3.FromHexString(dim ? "#5b4cc8" : phase === "cruise" ? "#e8d9ff" : "#c8b8ff");
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
    const truck = new TransformNode("safari truck", scene);
    truck.position.set(OX, 0, OZ);
    const parts: Array<[number, number, number, number, number, number, string]> = [
      [0, 0.55, 0, 2.0, 0.5, 4.6, "#e9e4d8"],
      [0, 0.2, 1.6, 2.1, 0.4, 0.4, "#202020"],
      [0, 0.2, -1.6, 2.1, 0.4, 0.4, "#202020"],
      [0, 1.95, -0.4, 1.9, 0.06, 2.8, "#2b2b2b"],
      [0, 1.15, 2.0, 1.9, 0.7, 0.06, "#7fb3d5"],
    ];
    for (const [x, y, z, w, h, d, hex] of parts) {
      const part = MeshBuilder.CreateBox("safari part", { width: w, height: h, depth: d }, scene);
      part.position.set(x, y, z);
      const material = new StandardMaterial("safari paint", scene);
      material.diffuseColor = Color3.FromHexString(hex);
      part.material = material;
      part.parent = truck;
      disposables.push(material);
    }
    for (const seat of EXCURSION_SEATS.safari) {
      const bench = MeshBuilder.CreateBox("safari seat", { width: 0.5, height: 0.12, depth: 0.5 }, scene);
      bench.position.set(seat.at[0], 0.38, seat.at[1]);
      bench.material = materials.seat;
      bench.parent = truck;
    }
    disposables.push(truck);
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
    setFlight(phase, progress, destination) {
      setFlight(phase, progress, destination);
    },
    dispose() {
      for (const mesh of meshes) mesh.dispose();
      for (const item of disposables) item.dispose();
      for (const entry of lights) entry.dispose();
    },
  };
}
