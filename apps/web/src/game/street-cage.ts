import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { FOOTBALL, FOOTBALL_KITS, fromPitch, STREET_PITCHES, type FootballState, type StreetPitch } from "@lagos-living/shared";

const SHOW_METRES = 220;

type Cage = { pitch: StreetPitch; root: TransformNode | null; ball: Mesh | null; state: FootballState | null; receivedAt: number; shown: Vector3 | null };
export type HolderPose = { x: number; y: number; z: number; yaw: number };

/**
 * The street cages: a painted five-a-side pitch with kick boards and a fence round it, a goal at each end with a net,
 * and the match ball. The room runs the ball; this draws it between updates, rolling on from its last speed, and
 * keeps a dribbled ball at the feet of whoever has it.
 */
export class StreetCagesView {
  private readonly cages = new Map<string, Cage>();

  constructor(
    private readonly scene: Scene,
    private readonly ground: (x: number, z: number) => number,
    private readonly addCaster: (meshes: AbstractMesh[]) => void,
    private readonly holderPose: (sessionId: string) => HolderPose | null,
  ) {
    for (const pitch of STREET_PITCHES) this.cages.set(pitch.id, { pitch, root: null, ball: null, state: null, receivedAt: 0, shown: null });
  }

  private material(name: string, hex: string, glow = 0, alpha = 1) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(hex);
    material.emissiveColor = Color3.FromHexString(hex).scale(glow);
    material.specularColor = new Color3(0.05, 0.05, 0.05);
    if (alpha < 1) {
      material.alpha = alpha;
      material.backFaceCulling = false;
    }
    return material;
  }

  private build(cage: Cage) {
    const { pitch } = cage;
    const id = pitch.id;
    const root = new TransformNode(`cage ${id}`, this.scene);
    root.position.set(pitch.centre[0], this.ground(...pitch.centre), pitch.centre[1]);
    root.rotation.y = pitch.yaw;
    const turf = this.material(`cage ${id} turf`, "#3d7a34", 0.08);
    const paint = this.material(`cage ${id} paint`, "#f2f2ec", 0.5);
    const board = this.material(`cage ${id} board`, "#1f5fa8", 0.15);
    const steel = this.material(`cage ${id} steel`, "#8a9097", 0.05);
    const net = this.material(`cage ${id} net`, "#f4f4f4", 0.3, 0.28);
    const fence = this.material(`cage ${id} fence`, "#5a6068", 0.05, 0.22);
    const parts: Mesh[] = [];
    // Local axes: +z along the pitch towards Gold's goal, +x across it.
    const part = (mesh: Mesh, material: StandardMaterial, x: number, y: number, z: number) => {
      mesh.material = material;
      mesh.parent = root;
      mesh.position.set(x, y, z);
      mesh.isPickable = false;
      parts.push(mesh);
      return mesh;
    };
    const [L, W] = [pitch.length, pitch.width];
    part(MeshBuilder.CreateBox(`cage ${id} turf`, { width: W + 3, height: 0.04, depth: L + 4 }, this.scene), turf, 0, 0.02, 0);
    const line = (width: number, depth: number, x: number, z: number) => part(MeshBuilder.CreateBox(`cage ${id} line`, { width, height: 0.012, depth }, this.scene), paint, x, 0.046, z);
    for (const side of [-1, 1]) {
      line(0.12, L, (side * W) / 2, 0);
      line(W, 0.12, 0, (side * L) / 2);
      const boxWidth = (FOOTBALL.goalWidth + 2) * 2;
      line(boxWidth, 0.12, 0, side * (L / 2 - FOOTBALL.boxDepth));
      for (const edge of [-1, 1]) line(0.12, FOOTBALL.boxDepth, (edge * boxWidth) / 2, side * (L / 2 - FOOTBALL.boxDepth / 2));
      part(MeshBuilder.CreateCylinder(`cage ${id} spot`, { diameter: 0.3, height: 0.012 }, this.scene), paint, 0, 0.046, side * (L / 2 - 4.5));
    }
    line(W, 0.12, 0, 0);
    const circle = part(MeshBuilder.CreateTorus(`cage ${id} circle`, { diameter: 7, thickness: 0.12, tessellation: 48 }, this.scene), paint, 0, 0.046, 0);
    circle.scaling.y = 0.08;
    part(MeshBuilder.CreateCylinder(`cage ${id} centre`, { diameter: 0.3, height: 0.012 }, this.scene), paint, 0, 0.046, 0);
    // Kick boards and a chain-link fence on every side, open only at the goal mouths.
    const margin = 1.2;
    for (const side of [-1, 1]) {
      const x = side * (W / 2 + margin);
      part(MeshBuilder.CreateBox(`cage ${id} board`, { width: 0.1, height: 0.7, depth: L + margin * 2 }, this.scene), board, x, 0.35, 0);
      part(MeshBuilder.CreatePlane(`cage ${id} fence`, { width: L + margin * 2, height: 3 }, this.scene), fence, x, 2.2, 0).rotation.y = Math.PI / 2;
      const z = side * (L / 2 + margin);
      for (const edge of [-1, 1]) {
        const span = (W + margin * 2 - FOOTBALL.goalWidth) / 2;
        const centre = edge * (FOOTBALL.goalWidth / 2 + span / 2);
        part(MeshBuilder.CreateBox(`cage ${id} end board`, { width: span, height: 0.7, depth: 0.1 }, this.scene), board, centre, 0.35, z);
      }
      part(MeshBuilder.CreatePlane(`cage ${id} end fence`, { width: W + margin * 2, height: 3 }, this.scene), fence, 0, 2.2, z);
      for (let along = -L / 2 - margin; along <= L / 2 + margin + 0.01; along += 5) {
        part(MeshBuilder.CreateCylinder(`cage ${id} post`, { diameter: 0.09, height: 3.7 }, this.scene), steel, x, 1.85, along);
      }
      part(MeshBuilder.CreateCylinder(`cage ${id} rail`, { diameter: 0.07, height: L + margin * 2 }, this.scene), steel, x, 3.7, 0).rotation.x = Math.PI / 2;
      // Goal: two posts, a bar, and a net box behind the line.
      const goal = side * (L / 2);
      const depth = 1.3;
      for (const edge of [-1, 1]) {
        part(MeshBuilder.CreateCylinder(`cage ${id} goal post`, { diameter: 0.1, height: FOOTBALL.goalHeight }, this.scene), paint, (edge * FOOTBALL.goalWidth) / 2, FOOTBALL.goalHeight / 2, goal);
        part(MeshBuilder.CreatePlane(`cage ${id} side net`, { width: depth, height: FOOTBALL.goalHeight }, this.scene), net, (edge * FOOTBALL.goalWidth) / 2, FOOTBALL.goalHeight / 2, goal + (side * depth) / 2).rotation.y = Math.PI / 2;
      }
      part(MeshBuilder.CreateCylinder(`cage ${id} bar`, { diameter: 0.1, height: FOOTBALL.goalWidth }, this.scene), paint, 0, FOOTBALL.goalHeight, goal).rotation.z = Math.PI / 2;
      part(MeshBuilder.CreatePlane(`cage ${id} back net`, { width: FOOTBALL.goalWidth, height: FOOTBALL.goalHeight }, this.scene), net, 0, FOOTBALL.goalHeight / 2, goal + side * depth);
      const roof = part(MeshBuilder.CreatePlane(`cage ${id} roof net`, { width: FOOTBALL.goalWidth, height: depth }, this.scene), net, 0, FOOTBALL.goalHeight, goal + (side * depth) / 2);
      roof.rotation.x = Math.PI / 2;
      // A strip of the side's colour on the kick board behind each goal: Green defend the -z end.
      const kit = FOOTBALL_KITS[side < 0 ? "green" : "gold"];
      part(MeshBuilder.CreateBox(`cage ${id} end stripe`, { width: W + margin * 2, height: 0.12, depth: 0.12 }, this.scene), this.material(`cage ${id} ${side} stripe`, kit.shirt, 0.4), 0, 0.75, z);
    }
    for (const mesh of parts) mesh.freezeWorldMatrix();
    this.addCaster(parts.filter((mesh) => mesh.material !== net && mesh.material !== fence && mesh.material !== turf));
    cage.root = root;
    const ball = MeshBuilder.CreateSphere(`cage ${id} ball`, { diameter: FOOTBALL.ballRadius * 2, segments: 12 }, this.scene);
    const texture = new DynamicTexture(`cage ${id} ball`, { width: 128, height: 64 }, this.scene, false);
    const context = texture.getContext() as CanvasRenderingContext2D;
    context.fillStyle = "#f7f7f7";
    context.fillRect(0, 0, 128, 64);
    context.fillStyle = "#151515";
    for (let i = 0; i < 6; i++) {
      context.beginPath();
      context.arc(10 + i * 21, i % 2 ? 18 : 44, 7, 0, Math.PI * 2);
      context.fill();
    }
    texture.update();
    const leather = this.material(`cage ${id} leather`, "#ffffff", 0.25);
    leather.diffuseTexture = texture;
    ball.material = leather;
    ball.isPickable = false;
    ball.rotationQuaternion = null;
    this.addCaster([ball]);
    cage.ball = ball;
  }

  private teardown(cage: Cage) {
    cage.root?.dispose(false, true);
    cage.ball?.dispose(false, true);
    Object.assign(cage, { root: null, ball: null, shown: null });
  }

  setState(state: FootballState) {
    const cage = this.cages.get(state.pitchId);
    if (!cage) return;
    cage.state = state;
    cage.receivedAt = performance.now();
  }

  update(x: number, z: number, hidden: boolean, dt: number) {
    const now = performance.now();
    for (const cage of this.cages.values()) {
      const distance = Math.hypot(cage.pitch.centre[0] - x, cage.pitch.centre[1] - z);
      if (!cage.root && !hidden && distance < SHOW_METRES) this.build(cage);
      else if (cage.root && distance > SHOW_METRES + 80) this.teardown(cage);
      if (!cage.root) continue;
      cage.root.setEnabled(!hidden);
      const ball = cage.ball!;
      ball.setEnabled(!hidden);
      if (hidden) continue;
      const target = this.ballTarget(cage, now);
      const previous = cage.shown ?? target.clone();
      const held = Boolean(cage.state?.holder);
      const blend = held ? Math.min(1, dt * 18) : Math.min(1, dt * 12);
      const shown = Vector3.Lerp(previous, target, cage.shown ? blend : 1);
      const moved = shown.subtract(previous);
      moved.y = 0;
      const travel = moved.length();
      if (travel > 0.0001) {
        // Rolling: spin about the axis across the direction of travel by the distance over the radius.
        const axis = Vector3.Cross(Vector3.Up(), moved.normalize());
        ball.rotate(axis, travel / FOOTBALL.ballRadius);
      }
      ball.position.copyFrom(shown);
      cage.shown = shown;
    }
  }

  private ballTarget(cage: Cage, now: number) {
    const { pitch } = cage;
    const state = cage.state;
    const groundAt = (px: number, pz: number) => this.ground(px, pz) + FOOTBALL.ballRadius;
    if (!state || state.phase === "lobby") {
      const [cx, cz] = pitch.centre;
      return new Vector3(cx, groundAt(cx, cz), cz);
    }
    if (state.holder) {
      const pose = this.holderPose(state.holder);
      if (pose) {
        const px = pose.x + Math.sin(pose.yaw) * 0.55;
        const pz = pose.z + Math.cos(pose.yaw) * 0.55;
        return new Vector3(px, groundAt(px, pz), pz);
      }
    }
    const ball = state.ball;
    const ahead = state.restartAt ? 0 : Math.min(0.25, (now - cage.receivedAt) / 1_000);
    const along = ball.along + ball.va * ahead;
    const across = ball.across + ball.vc * ahead;
    const [px, pz] = fromPitch(pitch, along, across);
    return new Vector3(px, groundAt(px, pz) + Math.max(0, ball.h), pz);
  }
}
