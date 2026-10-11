import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Material } from "@babylonjs/core/Materials/material";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { houseDesign, houseFootprint, PLOTS, type HouseDesign, type Plot } from "@lagos-living/shared";
import type { PlotState } from "../api";
import { buildProgress } from "./build-progress";
import type { Materials } from "./materials";

type PlotView = {
  root: TransformNode;
  house: TransformNode;
  key: string;
  sign: { texture: DynamicTexture; text: string };
  /** Sliding leaf of the compound gate, present once the house is finished; `open` runs 0 (shut) to 1. */
  gate: { leaf: TransformNode; open: number; target: number; width: number } | null;
};

const STOREY = 3;

/** Draws every plot: cleared ground, corner pegs, a signboard and whatever the builders have put up so far. */
export class PlotsView {
  private views = new Map<string, PlotView>();
  private readonly blocks: PBRMaterial;
  private readonly trench: PBRMaterial;

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
    return { root, house, key: "", sign: { texture, text: "" }, gate: null };
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

  /** Re-draws plots whose state changed; construction growth is redrawn in 10% steps. */
  update(states: PlotState[], now: number) {
    const byId = new Map(states.map((state) => [state.id, state]));
    for (const plot of PLOTS) {
      const view = this.views.get(plot.id)!;
      const state = byId.get(plot.id);
      const construction = state?.construction ?? null;
      const design = construction ? houseDesign(construction.designId) : null;
      if (!state || state.status === "available") this.drawSign(view, plot, "FOR LEASE OR SALE", "Walk up and press E", "#c0392b");
      else if (state.status === "mine") this.drawSign(view, plot, construction?.completed ? "YOUR HOUSE" : "YOUR PLOT", design ? design.name : "Choose a house design", "#1f7a4d");
      else this.drawSign(view, plot, construction?.completed ? "PRIVATE HOUSE" : "BUILDING SITE", "Held by a resident", "#59636b");
      const progress = construction ? buildProgress(construction, now) : null;
      const key = construction && design ? `${design.id}:${progress!.stage}:${Math.floor(progress!.fraction * 10)}` : "";
      if (key === view.key) continue;
      view.key = key;
      for (const child of view.house.getChildren()) child.dispose(false, false);
      const target = view.gate?.target ?? 0;
      view.gate = null;
      if (construction && design && progress) {
        this.buildHouse(view.house, plot, design, progress.stage, progress.fraction);
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
  private buildHouse(parent: TransformNode, plot: Plot, design: HouseDesign, stage: number, fraction: number) {
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
      if (floors > 1 && finishing > 0.7) {
        this.box(house, "balcony", [w * 0.6, 0.2, 1.6], [w * 0.15, 0.3 + STOREY, front - 0.8], m.plaster);
        this.box(house, "balcony glass", [w * 0.6, 1.0, 0.04], [w * 0.15, 0.3 + STOREY + 0.6, front - 1.58], m.glass);
        this.box(house, "balcony handrail", [w * 0.6, 0.05, 0.08], [w * 0.15, 0.3 + STOREY + 1.12, front - 1.58], m.chrome);
      }
      if (finishing > 0.9) {
        // A car porch to one side and planters along the front.
        const porchX = w / 2 + 1.7;
        if (porchX + 1.7 < plot.width / 2 - 0.4) {
          this.box(house, "car porch roof", [3.2, 0.16, 5.4], [porchX, 2.75, front + 1.4], m.plaster, true);
          this.box(house, "car porch pad", [3.0, 0.04, 5.2], [porchX, 0.1, front + 1.4], m.pavers);
          for (const pz of [front - 1.1, front + 3.9]) this.box(house, "car porch post", [0.12, 2.6, 0.12], [porchX + 1.45, 1.3, pz], m.gate);
        }
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

  dispose() {
    for (const view of this.views.values()) view.root.dispose(false, true);
    this.views.clear();
  }
}
