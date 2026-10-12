import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Material } from "@babylonjs/core/Materials/material";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BUSINESS_TYPES, houseDesign, houseFootprint, PLOT_SHOP, PLOTS, type HouseDesign, type Plot } from "@lagos-living/shared";
import type { PlotState } from "../api";
import { buildProgress } from "./build-progress";
import type { Materials } from "./materials";
import type { PropLibrary } from "./props";

type PlotView = {
  root: TransformNode;
  house: TransformNode;
  key: string;
  sign: { texture: DynamicTexture; text: string };
  /** Sliding leaf of the compound gate, present once the house is finished; `open` runs 0 (shut) to 1. */
  gate: { leaf: TransformNode; open: number; target: number; width: number } | null;
  /** Models placed in world space (props freeze their matrices), disposed when the plot is redrawn. */
  extras: Array<{ dispose(): void }>;
};

const STOREY = 3;

/** Draws every plot: cleared ground, corner pegs, a signboard and whatever the builders have put up so far. */
export class PlotsView {
  private views = new Map<string, PlotView>();
  private readonly blocks: PBRMaterial;
  private readonly trench: PBRMaterial;
  private props: PropLibrary | null = null;
  private last: { states: PlotState[]; now: number } | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly materials: Materials,
    private readonly groundHeight: (x: number, z: number) => number,
    private readonly addShadowCaster: (mesh: Mesh) => void,
  ) {
    this.blocks = materials.concrete.clone("sandcrete blocks") as PBRMaterial;
    this.blocks.albedoColor = Color3.FromHexString("#d6d2c6");
    this.trench = materials.dirt.clone("trench") as PBRMaterial;
    this.trench.albedoColor = Color3.FromHexString("#7a5a3c");
    for (const plot of PLOTS) this.views.set(plot.id, this.createPlot(plot));
  }

  private createPlot(plot: Plot): PlotView {
    const y = this.groundHeight(...plot.center);
    const root = new TransformNode(`plot ${plot.id}`, this.scene);
    root.position.set(plot.center[0], y, plot.center[1]);
    root.rotation.y = Math.atan2(plot.inward[0], plot.inward[1]);
    const ground = MeshBuilder.CreateGround(`plot ground ${plot.id}`, { width: plot.width, height: plot.depth }, this.scene);
    ground.material = this.materials.dirt;
    ground.position.y = 0.04;
    ground.parent = root;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const peg = MeshBuilder.CreateBox(`plot peg ${plot.id}`, { width: 0.12, height: 0.9, depth: 0.12 }, this.scene);
      peg.material = this.materials.paintYellow;
      peg.position.set((sx * plot.width) / 2, 0.45, (sz * plot.depth) / 2);
      peg.parent = root;
    }
    // Signboard just inside the gate, readable from the street.
    const signZ = -plot.depth / 2 + 0.4;
    const signX = plot.width / 2 - 2.2;
    for (const offset of [-0.9, 0.9]) {
      const post = MeshBuilder.CreateBox(`plot sign post ${plot.id}`, { width: 0.08, height: 2.1, depth: 0.08 }, this.scene);
      post.material = this.materials.pole;
      post.position.set(signX + offset, 1.05, signZ);
      post.parent = root;
    }
    const texture = new DynamicTexture(`plot sign ${plot.id}`, { width: 512, height: 256 }, this.scene, true);
    const material = new StandardMaterial(`plot sign ${plot.id}`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveColor = new Color3(0.35, 0.35, 0.35);
    material.specularColor = Color3.Black();
    const board = MeshBuilder.CreatePlane(`plot board ${plot.id}`, { width: 2.0, height: 1.0, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    board.material = material;
    board.position.set(signX, 1.75, signZ - 0.05);
    board.parent = root;
    const house = new TransformNode(`plot house ${plot.id}`, this.scene);
    house.parent = root;
    return { root, house, key: "", sign: { texture, text: "" }, gate: null, extras: [] };
  }

  private drawSign(view: PlotView, plot: Plot, title: string, line: string, colour: string) {
    const text = `${title}|${line}|${colour}`;
    if (view.sign.text === text) return;
    view.sign.text = text;
    const context = view.sign.texture.getContext() as CanvasRenderingContext2D;
    context.fillStyle = colour;
    context.fillRect(0, 0, 512, 256);
    context.fillStyle = "#ffffff";
    context.fillRect(10, 10, 492, 236);
    context.fillStyle = colour;
    context.fillRect(10, 10, 492, 70);
    context.fillStyle = "#ffffff";
    context.font = "bold 46px sans-serif";
    context.textAlign = "center";
    context.fillText(plot.name.toUpperCase(), 256, 62);
    context.fillStyle = "#1d2321";
    context.font = "bold 44px sans-serif";
    context.fillText(title, 256, 150);
    context.font = "30px sans-serif";
    context.fillText(line, 256, 205);
    view.sign.texture.update();
  }

  /** Once the prop library is up, helipads get the Meshy helicopter instead of the simple one. */
  setProps(props: PropLibrary) {
    this.props = props;
    void props.ensure(["helicopter"]).then(() => {
      if (this.last) this.update(this.last.states, this.last.now);
    });
  }

  /** Re-draws plots whose state changed; construction growth is redrawn in 10% steps. */
  update(states: PlotState[], now: number) {
    this.last = { states, now };
    const byId = new Map(states.map((state) => [state.id, state]));
    for (const plot of PLOTS) {
      const view = this.views.get(plot.id)!;
      const state = byId.get(plot.id);
      const construction = state?.construction ?? null;
      const design = construction ? houseDesign(construction.designId) : null;
      const shop = state?.business ?? null;
      if (!state || state.status === "available") this.drawSign(view, plot, "LAND FOR SALE", "Empty plot · walk up, press E", "#c0392b");
      else if (shop) this.drawSign(view, plot, shop.name.toUpperCase().slice(0, 20), BUSINESS_TYPES[shop.type]?.name ?? "Open for business", "#9a6b12");
      else if (state.status === "mine") this.drawSign(view, plot, construction?.completed ? "YOUR HOUSE" : "YOUR PLOT", design ? design.name : "Build a house or business", "#1f7a4d");
      else this.drawSign(view, plot, construction?.completed ? "PRIVATE HOUSE" : "BUILDING SITE", "Held by a resident", "#59636b");
      const progress = construction ? buildProgress(construction, now) : null;
      const heli = design?.helipad && this.props?.has("helicopter") ? ":heli" : "";
      const key = shop ? `shop:${shop.type}:${shop.name}` : construction && design ? `${design.id}:${progress!.stage}:${Math.floor(progress!.fraction * 10)}${heli}` : "";
      if (key === view.key) continue;
      view.key = key;
      for (const child of view.house.getChildren()) child.dispose(false, false);
      for (const extra of view.extras.splice(0)) extra.dispose();
      const target = view.gate?.target ?? 0;
      view.gate = null;
      if (shop) this.buildShop(view, plot, shop);
      else if (construction && design && progress) {
        this.buildHouse(view, plot, design, progress.stage, progress.fraction);
        if (construction.completed) view.gate = this.buildCompound(view.house, plot, target);
      }
    }
  }

  /** Opens or shuts a finished house's gate; it slides over a couple of seconds. */
  setGateOpen(plotId: string, open: boolean) {
    const gate = this.views.get(plotId)?.gate;
    if (gate) gate.target = open ? 1 : 0;
  }

  gateOpen(plotId: string) {
    return this.views.get(plotId)?.gate?.open ?? 0;
  }

  animate(dt: number) {
    for (const view of this.views.values()) {
      const gate = view.gate;
      if (!gate || gate.open === gate.target) continue;
      const step = dt * 0.5;
      gate.open = gate.target > gate.open ? Math.min(gate.target, gate.open + step) : Math.max(gate.target, gate.open - step);
      gate.leaf.position.x = gate.open * (gate.width + 0.1);
    }
  }

  /** Boundary wall with steel railings, a lawn, a paved drive and a sliding gate at the street. */
  private buildCompound(parent: TransformNode, plot: Plot, open: number) {
    const m = this.materials;
    const hw = plot.width / 2;
    const hd = plot.depth / 2;
    const gateWidth = Math.min(4.2, plot.width - 2);
    const lawn = MeshBuilder.CreateGround(`plot lawn ${plot.id}`, { width: plot.width - 0.6, height: plot.depth - 0.6 }, this.scene);
    lawn.material = m.grass;
    lawn.position.y = 0.06;
    lawn.parent = parent;
    this.box(parent, "drive", [gateWidth, 0.04, 2.9], [0, 0.09, -hd + 1.5], m.pavers);
    const wall = (name: string, length: number, x: number, z: number, alongX: boolean) => {
      const size: [number, number, number] = alongX ? [length, 1.0, 0.25] : [0.25, 1.0, length];
      this.box(parent, name, size, [x, 0.5, z], m.walls, true);
      const coping: [number, number, number] = alongX ? [length + 0.1, 0.08, 0.35] : [0.35, 0.08, length + 0.1];
      this.box(parent, `${name} coping`, coping, [x, 1.04, z], m.concrete);
      const bars = Math.floor(length / 0.25);
      for (let index = 0; index <= bars; index += 4) {
        const offset = -length / 2 + (index / bars) * length;
        this.box(parent, `${name} railing`, [0.05, 0.9, 0.05], alongX ? [x + offset, 1.5, z] : [x, 1.5, z + offset], m.gate);
      }
      this.box(parent, `${name} rail`, alongX ? [length, 0.05, 0.05] : [0.05, 0.05, length], [x, 1.93, z], m.gate);
    };
    const side = (plot.width - gateWidth) / 2;
    wall("front wall left", side, -hw + side / 2, -hd, true);
    wall("front wall right", side, hw - side / 2, -hd, true);
    wall("back wall", plot.width, 0, hd, true);
    wall("left wall", plot.depth, -hw, 0, false);
    wall("right wall", plot.depth, hw, 0, false);
    for (const x of [-gateWidth / 2 - 0.25, gateWidth / 2 + 0.25]) {
      this.box(parent, "gate pillar", [0.5, 2.3, 0.5], [x, 1.15, -hd], m.walls, true);
      this.box(parent, "gate lamp", [0.22, 0.22, 0.22], [x, 2.42, -hd], m.lamp);
    }
    const leaf = new TransformNode(`plot gate ${plot.id}`, this.scene);
    leaf.parent = parent;
    leaf.position.set(open * (gateWidth + 0.1), 0, -hd - 0.3);
    this.box(leaf, "gate leaf", [gateWidth, 1.9, 0.07], [0, 1.0, 0], m.gate, true);
    for (let index = 1; index < 8; index += 1) this.box(leaf, "gate slat", [0.04, 1.7, 0.1], [-gateWidth / 2 + (gateWidth * index) / 8, 1.0, 0], m.wood);
    return { leaf, open, target: open, width: gateWidth };
  }

  private box(parent: TransformNode, name: string, size: [number, number, number], position: [number, number, number], material: Material, shadow = false) {
    const mesh = MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, this.scene);
    mesh.material = material;
    mesh.position.set(...position);
    mesh.parent = parent;
    if (shadow) this.addShadowCaster(mesh);
    return mesh;
  }

  /** Local frame: x along the street, z into the plot, front wall facing the gate at -z. */
  private buildHouse(view: PlotView, plot: Plot, design: HouseDesign, stage: number, fraction: number) {
    const parent = view.house;
    const corners = houseFootprint(plot, design);
    const cx = (corners[0]![0] + corners[2]![0]) / 2 - plot.center[0];
    const cz = (corners[0]![1] + corners[2]![1]) / 2 - plot.center[1];
    // Into the plot's rotated frame.
    const localZ = cx * plot.inward[0] + cz * plot.inward[1];
    const localX = cx * plot.inward[1] - cz * plot.inward[0];
    const house = new TransformNode(`house ${plot.id}`, this.scene);
    house.parent = parent;
    house.position.set(localX, 0, localZ);
    const { width: w, depth: d, floors } = design;
    const m = this.materials;
    const done = (index: number) => (stage > index ? 1 : stage === index ? fraction : 0);

    // Foundation: trenches first, then the slab rises.
    const foundation = done(0);
    if (foundation < 0.4) {
      for (const [sx, sz, lx, lz] of [[0, -d / 2, w, 0.5], [0, d / 2, w, 0.5], [-w / 2, 0, 0.5, d], [w / 2, 0, 0.5, d]] as const) {
        this.box(house, "trench", [lx, 0.06, lz], [sx, 0.05, sz], this.trench);
      }
    }
    if (foundation >= 0.2) this.box(house, "slab", [w + 0.6, 0.3 * Math.min(1, foundation * 1.25), d + 0.6], [0, 0.15 * Math.min(1, foundation * 1.25), 0], m.concrete, true);

    // Walls rise course by course; painted once finishing is well under way.
    const blockwork = done(1);
    const finishing = done(3);
    const fullHeight = floors * STOREY;
    const wallHeight = fullHeight * blockwork;
    const wallMaterial = finishing > 0.5 ? m.plaster : this.blocks;
    if (wallHeight > 0.05) {
      const t = 0.22;
      const y = 0.3 + wallHeight / 2;
      this.box(house, "wall back", [w, wallHeight, t], [0, y, d / 2 - t / 2], wallMaterial, true);
      this.box(house, "wall left", [t, wallHeight, d], [-w / 2 + t / 2, y, 0], wallMaterial, true);
      this.box(house, "wall right", [t, wallHeight, d], [w / 2 - t / 2, y, 0], wallMaterial, true);
      // Front wall leaves a door opening in the middle.
      const doorWidth = 1.2;
      const doorHeight = Math.min(2.2, wallHeight);
      const side = (w - doorWidth) / 2;
      this.box(house, "wall front left", [side, wallHeight, t], [-(doorWidth + side) / 2, y, -d / 2 + t / 2], wallMaterial, true);
      this.box(house, "wall front right", [side, wallHeight, t], [(doorWidth + side) / 2, y, -d / 2 + t / 2], wallMaterial, true);
      if (wallHeight > doorHeight + 0.05) {
        this.box(house, "lintel", [doorWidth, wallHeight - doorHeight, t], [0, 0.3 + doorHeight + (wallHeight - doorHeight) / 2, -d / 2 + t / 2], wallMaterial, true);
      }
      if (floors > 1 && wallHeight > STOREY) this.box(house, "first floor slab", [w, 0.25, d], [0, 0.3 + STOREY, 0], m.concrete);
    }

    // Roof: a modern flat slab with a deep overhang and a thin dark fascia; the duplex steps its upper floor back.
    const roofing = done(2);
    if (roofing > 0.05) {
      const top = 0.3 + fullHeight;
      const slab = 0.32 * roofing;
      this.box(house, "roof slab", [w + 1.4, slab, d + 1.0], [0, top + slab / 2, -0.2], finishing > 0.5 ? m.plaster : m.concrete, true);
      if (design.helipad && roofing > 0.6 && finishing > 0.9) this.buildHelipad(view, house, top + slab, Math.min(w, d) - 1.6);
      if (roofing > 0.6) {
        this.box(house, "fascia", [w + 1.44, 0.12, 0.06], [0, top + slab - 0.06, -d / 2 - 0.72], m.gate);
        for (const [sx, sz, lx, lz] of [[0, -d / 2 - 0.65, w + 1.4, 0.12], [0, d / 2 + 0.25, w + 1.4, 0.12], [-w / 2 - 0.65, -0.2, 0.12, d + 1.0], [w / 2 + 0.65, -0.2, 0.12, d + 1.0]] as const) {
          this.box(house, "parapet", [lx, 0.45, lz], [sx, top + slab + 0.22, sz], finishing > 0.5 ? m.plaster : this.blocks);
        }
      }
    }

    // Finishing: door, windows and, for the duplex, a balcony.
    // Finishing: tall pivot door, floor-to-ceiling glazing in dark frames, a timber-clad panel and wall lights.
    if (finishing > 0.3) {
      const front = -d / 2;
      this.box(house, "front door", [1.1, 2.5, 0.08], [0, 0.3 + 1.25, front - 0.03], m.wood);
      this.box(house, "door frame", [1.3, 0.1, 0.12], [0, 0.3 + 2.55, front - 0.04], m.gate);
      for (const sx of [-0.7, 0.7]) this.box(house, "wall light", [0.14, 0.32, 0.12], [sx, 0.3 + 2.0, front - 0.08], m.lamp);
      const pane = Math.min(2.6, (w - 1.4) / 2 - 1.0);
      for (let floor = 0; floor < floors; floor += 1) {
        const y0 = 0.3 + floor * STOREY + 0.25;
        const tall = STOREY - 0.6;
        for (const sign of [-1, 1]) {
          const wx = sign * (0.55 + 0.5 + pane / 2);
          if (floor === 0 && sign < 0) {
            this.box(house, "timber cladding", [pane + 0.6, STOREY - 0.1, 0.06], [wx, 0.3 + STOREY / 2, front - 0.04], m.wood);
            continue;
          }
          this.box(house, "glazing", [pane, tall, 0.05], [wx, y0 + tall / 2, front - 0.03], m.glass);
          this.box(house, "glazing head", [pane + 0.12, 0.08, 0.1], [wx, y0 + tall, front - 0.05], m.gate);
          this.box(house, "glazing sill", [pane + 0.12, 0.08, 0.1], [wx, y0, front - 0.05], m.gate);
          this.box(house, "mullion", [0.06, tall, 0.1], [wx, y0 + tall / 2, front - 0.05], m.gate);
        }
        for (const wx of [-w / 2 + 1.8, w / 2 - 1.8]) this.box(house, "window back", [1.8, 1.5, 0.06], [wx, 0.3 + floor * STOREY + 1.5, d / 2 + 0.03], m.glass);
        for (const sx of [-1, 1]) this.box(house, "side window", [0.06, 1.2, 1.6], [sx * (w / 2 + 0.03), 0.3 + floor * STOREY + 1.6, 0], m.glass);
      }
      if (design.helipad && finishing > 0.7) {
        // Sky mansion: full-width curtain glass on the upper floors, each with a cantilevered glass-railed terrace.
        for (let floor = 1; floor < floors; floor += 1) {
          const y0 = 0.3 + floor * STOREY;
          this.box(house, "curtain glass", [w - 0.5, STOREY - 0.35, 0.04], [0, y0 + (STOREY - 0.35) / 2 + 0.1, front - 0.07], m.glass);
          for (let index = 0; index <= 7; index += 1) this.box(house, "curtain mullion", [0.07, STOREY - 0.35, 0.09], [-(w - 0.5) / 2 + (index * (w - 0.5)) / 7, y0 + (STOREY - 0.35) / 2 + 0.1, front - 0.1], m.darkFrame);
          this.box(house, "terrace slab", [w + 0.6, 0.22, 1.7], [0, y0, front - 0.85], m.plaster, true);
          this.box(house, "terrace glass", [w + 0.6, 1.0, 0.04], [0, y0 + 0.6, front - 1.68], m.glass);
          this.box(house, "terrace rail", [w + 0.6, 0.05, 0.07], [0, y0 + 1.12, front - 1.68], m.chrome);
          this.box(house, "terrace downlight", [w - 1, 0.03, 0.12], [0, y0 - 0.12, front - 1.4], m.lamp);
        }
      } else if (floors > 1 && finishing > 0.7) {
        this.box(house, "balcony", [w * 0.6, 0.2, 1.6], [w * 0.15, 0.3 + STOREY, front - 0.8], m.plaster);
        this.box(house, "balcony glass", [w * 0.6, 1.0, 0.04], [w * 0.15, 0.3 + STOREY + 0.6, front - 1.58], m.glass);
        this.box(house, "balcony handrail", [w * 0.6, 0.05, 0.08], [w * 0.15, 0.3 + STOREY + 1.12, front - 1.58], m.chrome);
      }
      if (finishing > 0.9) {
        this.buildGrounds(house, plot, design, localZ);
        for (const px of [-w / 2 + 0.8, w / 2 - 0.8]) {
          this.box(house, "planter", [1.2, 0.45, 0.5], [px, 0.53, front - 1.0], m.concrete);
          this.box(house, "shrub", [1.0, 0.5, 0.4], [px, 0.98, front - 1.0], m.bush);
        }
      }
    }

    // Scaffold poles while the builders are on site.
    if (stage < 3 || finishing < 1) {
      if (blockwork > 0.1) {
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1]] as const) {
          const pole = MeshBuilder.CreateCylinder("scaffold", { diameter: 0.08, height: wallHeight + 1.2, tessellation: 6 }, this.scene);
          pole.material = m.pole;
          pole.position.set(sx * (w / 2 + 0.6), 0.3 + (wallHeight + 1.2) / 2, sz * (d / 2 + 0.6));
          pole.parent = house;
        }
      }
      if (stage <= 1) {
        // A pile of blocks and sand by the gate.
        this.box(house, "block stack", [1.6, 0.8, 1.0], [w / 2 + 1.6, 0.4, -d / 2 - 1.2], this.blocks);
        this.box(house, "sand heap", [1.4, 0.5, 1.4], [-w / 2 - 1.6, 0.25, -d / 2 - 1.2], this.trench);
      }
    }
  }

  /**
   * Carports beside the house (bays nose to tail, one or both sides), a paved forecourt linking them to the gate,
   * and the pool garden behind. House frame: front wall at -depth/2; `localZ` is the house centre from the plot centre.
   */
  private buildGrounds(house: TransformNode, plot: Plot, design: HouseDesign, localZ: number) {
    const m = this.materials;
    const { width: w, depth: d } = design;
    const front = -d / 2;
    const plotFront = -plot.depth / 2 - localZ;
    const plotBack = plot.depth / 2 - localZ;
    const sides = design.parking > 2 ? [1, -1] : design.parking > 0 ? [1] : [];
    const bay = 5.4;
    if (sides.length) this.box(house, "forecourt", [plot.width - 1.0, 0.04, front - plotFront - 0.5], [0, 0.085, (plotFront + 0.4 + front) / 2], m.pavers);
    for (const side of sides) {
      const bays = Math.ceil(design.parking / sides.length);
      const length = bays * bay;
      const x = side * (w / 2 + 1.75);
      const z0 = plotFront + 0.6;
      const zc = z0 + length / 2;
      this.box(house, "carport pad", [3.2, 0.05, length], [x, 0.1, zc], m.pavers);
      this.box(house, "carport roof", [3.4, 0.18, length + 0.2], [x, 2.8, zc], m.plaster, true);
      this.box(house, "carport fascia", [3.44, 0.1, length + 0.24], [x, 2.66, zc], m.gate);
      for (let index = 0; index <= bays; index += 1) {
        const pz = z0 + index * bay;
        this.box(house, "carport post", [0.14, 2.7, 0.14], [x + side * 1.55, 1.35, Math.min(pz, z0 + length - 0.1)], m.gate);
        if (index > 0 && index < bays) this.box(house, "bay line", [3.0, 0.02, 0.1], [x, 0.135, pz], m.paintWhite);
      }
      this.box(house, "carport light", [0.5, 0.05, 0.5], [x, 2.69, zc], m.lamp);
    }
    if (!design.pool) return;
    const [poolW, poolL] = design.pool;
    const garden = plotBack - d / 2;
    const zc = d / 2 + garden / 2;
    this.box(house, "pool deck", [Math.min(plot.width - 1.2, poolW + 3.2), 0.1, Math.min(garden - 0.6, poolL + 2.2)], [0, 0.1, zc], m.pavers);
    this.box(house, "pool coping", [poolW + 0.5, 0.12, poolL + 0.5], [0, 0.16, zc], m.concrete);
    this.box(house, "pool water", [poolW, 0.04, poolL], [0, 0.21, zc], m.water);
    for (const [lx, lz] of [[-poolW / 2 + 0.25, -poolL / 2 + 0.25], [poolW / 2 - 0.25, poolL / 2 - 0.25]] as const) {
      this.box(house, "pool light", [0.2, 0.03, 0.2], [lx, 0.2, zc + lz], m.lamp);
    }
    const deckX = poolW / 2 + 0.9;
    for (const [index, lx] of [-deckX, deckX].entries()) {
      if (Math.abs(lx) + 0.4 > plot.width / 2 - 0.6) continue;
      this.box(house, "sun lounger", [0.7, 0.25, 1.9], [lx, 0.3, zc - 0.2 + index * 0.3], m.paintWhite);
      this.box(house, "lounger back", [0.7, 0.55, 0.12], [lx, 0.55, zc + 0.7 + index * 0.3], m.paintWhite);
    }
    this.box(house, "umbrella pole", [0.06, 2.4, 0.06], [deckX, 1.3, zc - 1.5], m.chrome);
    const canopy = MeshBuilder.CreateCylinder("umbrella", { height: 0.35, diameterTop: 0.05, diameterBottom: 2.2, tessellation: 8 }, this.scene);
    canopy.material = m.awningRed;
    canopy.position.set(deckX, 2.5, zc - 1.5);
    canopy.parent = house;
    this.addShadowCaster(canopy);
  }

  /** Local-frame point of a plot node to world space, for props that are placed in world coordinates. */
  private toWorld(node: TransformNode, x: number, y: number, z: number) {
    node.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(new Vector3(x, y, z), node.getWorldMatrix());
  }

  /** A marked rooftop landing pad: dark deck, yellow ring, white H, edge lights and a parked helicopter. */
  private buildHelipad(view: PlotView, house: TransformNode, y: number, size: number) {
    const m = this.materials;
    const radius = size / 2;
    this.box(house, "helipad deck", [size, 0.08, size], [0, y + 0.04, 0], m.asphalt);
    const ring = MeshBuilder.CreateTorus("helipad ring", { diameter: radius * 1.6, thickness: 0.28, tessellation: 40 }, this.scene);
    ring.scaling.y = 0.08;
    ring.position.set(0, y + 0.1, 0);
    ring.material = m.paintYellow;
    ring.parent = house;
    for (const sx of [-1, 1]) this.box(house, "helipad H upright", [0.45, 0.02, 3.2], [sx * 0.9, y + 0.1, 0], m.paintWhite);
    this.box(house, "helipad H bar", [1.4, 0.02, 0.45], [0, y + 0.1, 0], m.paintWhite);
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      this.box(house, "helipad light", [0.18, 0.12, 0.18], [Math.cos(angle) * (radius - 0.3), y + 0.14, Math.sin(angle) * (radius - 0.3)], index % 3 === 0 ? m.neon : m.lamp);
    }
    this.box(house, "windsock pole", [0.06, 2.0, 0.06], [radius - 0.2, y + 1.0, radius - 0.2], m.chrome);
    this.box(house, "windsock", [0.9, 0.28, 0.28], [radius - 0.7, y + 1.85, radius - 0.2], m.awningRed);
    const yaw = view.root.rotation.y + Math.PI * 0.75;
    const spot = this.toWorld(house, 0, y + 0.08, 0);
    if (this.props?.place("helicopter", spot.x, spot.z, yaw, view.extras, spot.y, 1)) return;
    // Simple stand-in until the model loads (or if it fails to).
    const heli = new TransformNode("helicopter", this.scene);
    heli.parent = house;
    heli.position.set(0, y + 0.08, 0);
    heli.rotation.y = Math.PI * 0.75;
    const body = MeshBuilder.CreateSphere("helicopter cabin", { diameterX: 1.8, diameterY: 1.7, diameterZ: 3.6, segments: 12 }, this.scene);
    body.material = m.gate;
    body.position.set(0, 1.35, 0.3);
    body.parent = heli;
    this.addShadowCaster(body);
    const glass = MeshBuilder.CreateSphere("helicopter glass", { diameterX: 1.6, diameterY: 1.2, diameterZ: 1.8, segments: 10 }, this.scene);
    glass.material = m.glass;
    glass.position.set(0, 1.55, 1.4);
    glass.parent = heli;
    const boom = MeshBuilder.CreateCylinder("helicopter tail", { height: 4.2, diameterTop: 0.22, diameterBottom: 0.55, tessellation: 10 }, this.scene);
    boom.rotation.x = -Math.PI / 2;
    boom.material = m.gate;
    boom.position.set(0, 1.55, -3.4);
    boom.parent = heli;
    this.box(heli, "helicopter fin", [0.08, 1.1, 0.7], [0, 2.0, -5.3], m.gate);
    this.box(heli, "helicopter tail rotor", [0.04, 1.2, 0.12], [0.12, 2.0, -5.3], m.chrome);
    this.box(heli, "helicopter mast", [0.18, 0.5, 0.18], [0, 2.35, 0.2], m.chrome);
    for (const angle of [0, Math.PI / 2]) {
      const blade = this.box(heli, "helicopter rotor", [9.0, 0.05, 0.28], [0, 2.62, 0.2], m.gate);
      blade.rotation.y = angle + 0.4;
    }
    for (const sx of [-0.85, 0.85]) {
      this.box(heli, "helicopter skid", [0.1, 0.1, 3.4], [sx, 0.1, 0.3], m.chrome);
      for (const sz of [-0.6, 1.2]) this.box(heli, "helicopter strut", [0.07, 0.5, 0.07], [sx * 0.9, 0.4, sz], m.chrome);
    }
  }

  /**
   * A business on the plot: a single-storey commercial unit with a glass shopfront, a lit fascia sign carrying the
   * business name, an awning, and a paved forecourt with marked customer parking.
   */
  private buildShop(view: PlotView, plot: Plot, shop: { type: string; name: string }) {
    const m = this.materials;
    const corners = houseFootprint(plot, PLOT_SHOP);
    const cx = (corners[0]![0] + corners[2]![0]) / 2 - plot.center[0];
    const cz = (corners[0]![1] + corners[2]![1]) / 2 - plot.center[1];
    const unit = new TransformNode(`shop ${plot.id}`, this.scene);
    unit.parent = view.house;
    unit.position.set(cx * plot.inward[1] - cz * plot.inward[0], 0, cx * plot.inward[0] + cz * plot.inward[1]);
    const { width: w, depth: d } = PLOT_SHOP;
    const h = 4.4;
    const front = -d / 2;
    const forecourtFront = -plot.depth / 2 - unit.position.z;
    this.box(view.house, "shop forecourt", [plot.width - 0.4, 0.05, plot.depth - 0.4], [0, 0.07, 0], m.pavers);
    this.box(unit, "shop slab", [w + 0.6, 0.3, d + 0.6], [0, 0.15, 0], m.concrete, true);
    this.box(unit, "shop back", [w, h, 0.25], [0, 0.3 + h / 2, d / 2 - 0.12], m.plaster, true);
    for (const sx of [-1, 1]) this.box(unit, "shop side", [0.25, h, d], [sx * (w / 2 - 0.12), 0.3 + h / 2, 0], m.plaster, true);
    this.box(unit, "shop roof", [w + 0.8, 0.35, d + 0.8], [0, 0.3 + h + 0.17, 0], m.plaster, true);
    this.box(unit, "shop floor", [w - 0.5, 0.02, d - 0.5], [0, 0.31, 0], m.tiles);
    // Glass shopfront with bronze mullions and a central door.
    this.box(unit, "shopfront glass", [w - 0.5, 3.0, 0.06], [0, 0.3 + 1.5, front + 0.1], m.showroomGlass);
    for (let index = 0; index <= 6; index += 1) this.box(unit, "shopfront mullion", [0.1, 3.0, 0.14], [-w / 2 + 0.25 + (index * (w - 0.5)) / 6, 0.3 + 1.5, front + 0.1], m.darkFrame);
    this.box(unit, "shopfront head", [w - 0.5, 0.14, 0.16], [0, 0.3 + 3.05, front + 0.1], m.darkFrame);
    this.box(unit, "shop door handle", [0.05, 1.0, 0.08], [0.25, 0.3 + 1.1, front + 0.02], m.chrome);
    this.box(unit, "shop counter", [3.6, 1.05, 0.7], [0, 0.3 + 0.52, 1.2], m.wood);
    for (const sx of [-3.8, 3.8]) this.box(unit, "shop shelf", [2.2, 2.2, 0.5], [sx, 0.3 + 1.1, d / 2 - 0.6], m.wood);
    this.box(unit, "shop ceiling light", [w - 2, 0.06, 0.3], [0, 0.3 + h - 0.1, 0], m.lamp);
    // Lit fascia sign above the glazing.
    const texture = new DynamicTexture(`shop sign ${plot.id}`, { width: 1024, height: 192 }, this.scene, true);
    const context = texture.getContext() as CanvasRenderingContext2D;
    const accent = BUSINESS_TYPES[shop.type as keyof typeof BUSINESS_TYPES];
    context.fillStyle = "#14161a";
    context.fillRect(0, 0, 1024, 192);
    context.fillStyle = "#e8b64c";
    context.fillRect(0, 170, 1024, 22);
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.font = "bold 92px sans-serif";
    context.fillText(`${accent?.emoji ?? ""} ${shop.name}`.trim().slice(0, 26), 512, 110);
    context.font = "34px sans-serif";
    context.fillStyle = "#e8b64c";
    context.fillText((accent?.name ?? "").toUpperCase(), 512, 158);
    texture.update();
    const signMaterial = new StandardMaterial(`shop sign ${plot.id}`, this.scene);
    signMaterial.diffuseTexture = texture;
    signMaterial.emissiveTexture = texture;
    signMaterial.specularColor = Color3.Black();
    const sign = MeshBuilder.CreatePlane(`shop fascia ${plot.id}`, { width: w - 0.6, height: (w - 0.6) * (192 / 1024) }, this.scene);
    sign.material = signMaterial;
    sign.position.set(0, 0.3 + 3.75, front - 0.04);
    sign.parent = unit;
    view.extras.push(signMaterial, texture);
    const awning = this.box(unit, "shop awning", [w - 0.4, 0.08, 1.6], [0, 0.3 + 3.25, front - 0.8], m.awningGreen, true);
    awning.rotation.x = -0.12;
    for (const sx of [-w / 2 + 0.6, w / 2 - 0.6]) {
      this.box(unit, "shop planter", [1.0, 0.5, 0.5], [sx, 0.55, front - 0.6], m.concrete);
      this.box(unit, "shop shrub", [0.9, 0.5, 0.4], [sx, 1.05, front - 0.6], m.bush);
    }
    // Customer bays between the shopfront and the street.
    for (let index = -2; index <= 2; index += 1) this.box(unit, "shop bay line", [0.1, 0.02, 2.2], [index * 2.6, 0.11, (front + forecourtFront) / 2], m.paintWhite);
  }

  dispose() {
    for (const view of this.views.values()) {
      for (const extra of view.extras.splice(0)) extra.dispose();
      view.root.dispose(false, true);
    }
    this.views.clear();
  }
}
