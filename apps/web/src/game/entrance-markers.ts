import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Vec2 } from "@lagos-living/shared";

export type EntranceCandidate = { key: string; point: Vec2; name: string };

type Marker = { root: TransformNode; arrow: Mesh; texture: DynamicTexture; accent: string; key: string | null };

/** Doors further than this get no marker; only the nearest few are lit so phones draw a handful of meshes. */
const SHOW_RANGE = 70;
const POOL = 3;
const BILLBOARD_Y = 2;
/** The route's own door gets a bigger cyan marker from further out, drawn instead of the gold one. */
const DESTINATION_RANGE = 160;

/**
 * Glowing floor rings, a bobbing arrow and a name board over the door of nearby places outdoors, and a green EXIT
 * marker over the way out indoors, so nobody has to run around a building looking for the door.
 */
export class EntranceMarkers {
  private readonly markers: Marker[] = [];
  private readonly exit: Marker;
  private readonly destination: Marker;
  private destinationRing: Mesh | null = null;
  private destinationName: string | null = null;
  private elapsed = 0;
  private sinceChoose = 1;

  constructor(private readonly scene: Scene, private readonly ground: (x: number, z: number) => number) {
    const gold = this.material("entrance gold", new Color3(1, 0.74, 0.18));
    const green = this.material("entrance green", new Color3(0.2, 0.95, 0.45));
    for (let index = 0; index < POOL; index += 1) this.markers.push(this.marker(`entrance ${index}`, gold, "#ffbe2e"));
    this.exit = this.marker("exit marker", green, "#33f273");
    this.draw(this.exit, "EXIT", "Way out");
    const cyan = this.material("destination cyan", new Color3(0.2, 0.85, 1));
    this.destination = this.marker("destination marker", cyan, "#3fd8ff");
    const ring = MeshBuilder.CreateTorus("destination outer ring", { diameter: 3.4, thickness: 0.12, tessellation: 32 }, this.scene);
    ring.material = cyan;
    ring.parent = this.destination.root;
    ring.position.y = 0.08;
    ring.isPickable = false;
    this.destinationRing = ring;
    const pad = MeshBuilder.CreateDisc("destination pad", { radius: 1.1, tessellation: 28 }, this.scene);
    const padMaterial = this.material("destination pad", new Color3(0.2, 0.85, 1));
    padMaterial.alpha = 0.28;
    pad.material = padMaterial;
    pad.parent = this.destination.root;
    pad.rotation.x = Math.PI / 2;
    pad.position.y = 0.05;
    pad.isPickable = false;
    for (const child of this.destination.root.getChildMeshes()) if (child.name.endsWith("board")) child.position.y = 4.4;
  }

  private material(name: string, color: Color3) {
    const material = new StandardMaterial(name, this.scene);
    material.disableLighting = true;
    material.emissiveColor = color;
    material.alpha = 0.85;
    return material;
  }

  private marker(name: string, material: StandardMaterial, accent: string): Marker {
    const root = new TransformNode(name, this.scene);
    const ring = MeshBuilder.CreateTorus(`${name} ring`, { diameter: 2.2, thickness: 0.09, tessellation: 28 }, this.scene);
    ring.material = material;
    ring.parent = root;
    ring.position.y = 0.06;
    const arrow = MeshBuilder.CreateCylinder(`${name} arrow`, { diameterTop: 0, diameterBottom: 0.7, height: 0.7, tessellation: 4 }, this.scene);
    arrow.material = material;
    arrow.parent = root;
    arrow.rotation.x = Math.PI;
    const texture = new DynamicTexture(`${name} board`, { width: 512, height: 128 }, this.scene, true);
    texture.hasAlpha = true;
    const boardMaterial = new StandardMaterial(`${name} board`, this.scene);
    boardMaterial.disableLighting = true;
    boardMaterial.emissiveTexture = texture;
    boardMaterial.opacityTexture = texture;
    boardMaterial.backFaceCulling = false;
    const label = MeshBuilder.CreatePlane(`${name} board`, { width: 3.2, height: 0.8 }, this.scene);
    label.material = boardMaterial;
    label.parent = root;
    label.position.y = 3.5;
    label.billboardMode = BILLBOARD_Y;
    for (const mesh of [ring, arrow, label]) {
      mesh.isPickable = false;
      mesh.doNotSyncBoundingInfo = true;
    }
    root.setEnabled(false);
    return { root, arrow, texture, accent, key: null };
  }

  private draw(marker: Marker, title: string, name: string) {
    const context = marker.texture.getContext() as CanvasRenderingContext2D;
    context.clearRect(0, 0, 512, 128);
    context.fillStyle = "rgba(10, 12, 14, 0.78)";
    context.beginPath();
    context.roundRect(4, 4, 504, 120, 26);
    context.fill();
    context.fillStyle = marker.accent;
    context.font = "bold 46px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(title, 256, 56);
    context.fillStyle = "#ffffff";
    context.font = "30px system-ui, sans-serif";
    context.fillText(name.length > 30 ? `${name.slice(0, 29)}…` : name, 256, 100);
    marker.texture.update();
  }

  private place(marker: Marker, [x, z]: Vec2, y = this.ground(x, z)) {
    marker.root.position.set(x, y, z);
    marker.root.setEnabled(true);
  }

  /** `candidates` is only read when it is time to re-pick the nearest doors; interior floors sit at y = 0. */
  update(dt: number, player: Vec2, outdoors: boolean, candidates: () => EntranceCandidate[], exit: Vec2 | null, destination: EntranceCandidate | null = null) {
    this.elapsed += dt;
    const bob = 2.3 + Math.sin(this.elapsed * 3) * 0.18;
    const target = outdoors && destination && Math.hypot(destination.point[0] - player[0], destination.point[1] - player[1]) < DESTINATION_RANGE ? destination : null;
    if (target) {
      if (this.destinationName !== target.name) {
        this.destinationName = target.name;
        this.draw(this.destination, "YOUR DESTINATION", `Walk in here · ${target.name}`);
      }
      this.place(this.destination, target.point);
      this.destination.arrow.position.y = bob + 0.6;
      const pulse = 1 + Math.sin(this.elapsed * 4) * 0.08;
      this.destinationRing?.scaling.set(pulse, 1, pulse);
    } else this.destination.root.setEnabled(false);
    if (exit) {
      this.place(this.exit, exit, 0);
      this.exit.arrow.position.y = bob;
    } else this.exit.root.setEnabled(false);

    if (!outdoors) {
      for (const marker of this.markers) marker.root.setEnabled(false);
      return;
    }
    this.sinceChoose += dt;
    if (this.sinceChoose > 0.5) {
      this.sinceChoose = 0;
      const near = candidates()
        .map((candidate) => ({ candidate, distance: Math.hypot(candidate.point[0] - player[0], candidate.point[1] - player[1]) }))
        .filter((entry) => entry.distance < SHOW_RANGE && !(target && Math.hypot(entry.candidate.point[0] - target.point[0], entry.candidate.point[1] - target.point[1]) < 3))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, POOL);
      this.markers.forEach((marker, index) => {
        const entry = near[index];
        if (!entry) {
          marker.root.setEnabled(false);
          marker.key = null;
          return;
        }
        if (marker.key !== entry.candidate.key) {
          marker.key = entry.candidate.key;
          this.draw(marker, "ENTRANCE", entry.candidate.name);
        }
        this.place(marker, entry.candidate.point);
      });
    }
    for (const marker of this.markers) if (marker.key) marker.arrow.position.y = bob;
  }

  dispose() {
    for (const marker of [...this.markers, this.exit, this.destination]) {
      marker.texture.dispose();
      marker.root.dispose(false, true);
    }
  }
}
