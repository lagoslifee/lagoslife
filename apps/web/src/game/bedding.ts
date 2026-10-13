import type { Scene } from "@babylonjs/core/scene";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

/** How high a body lying on its back stands off the mattress, from the soles (0) to the chest (1.35 m up the bed). */
const BODY: Array<[number, number]> = [[0, 0.13], [0.25, 0.11], [0.55, 0.15], [0.85, 0.2], [1.05, 0.24], [1.3, 0.27], [1.45, 0.22]];
const COVER_FROM = -0.12;
const COVER_TO = 1.38;

function bodyHeight(along: number) {
  for (let index = 1; index < BODY.length; index += 1) {
    const [d1, h1] = BODY[index]!;
    const [d0, h0] = BODY[index - 1]!;
    if (along <= d1) return h0 + ((h1 - h0) * Math.max(0, along - d0)) / (d1 - d0);
  }
  return BODY[BODY.length - 1]![1];
}

/**
 * A duvet pulled up to the chest of someone lying in bed: it rises over the body and falls flat to the mattress either
 * side, then over the edges, with the white top sheet folded back over it.
 */
export class Blanket {
  private readonly duvet: Mesh;
  private readonly fold: Mesh;

  constructor(scene: Scene, colour = "#2f4f7a") {
    const make = (name: string, hex: string, pattern = false) => {
      const material = new PBRMaterial(name, scene);
      material.albedoColor = pattern ? Color3.White() : Color3.FromHexString(hex);
      if (pattern) material.albedoTexture = adire(scene, hex);
      material.roughness = 0.95;
      material.metallic = 0;
      material.environmentIntensity = 0.6;
      material.backFaceCulling = false;
      return material;
    };
    const duvetPaths = this.paths(1.2, COVER_FROM, COVER_TO, 0);
    // Texture in metres, so the cloth pattern keeps its size over the folds rather than stretching to the ribbon.
    const uvs = duvetPaths.flatMap((path) => path.map((point) => new Vector2(point.x / 0.6, (-point.z + point.y) / 0.6)));
    this.duvet = MeshBuilder.CreateRibbon("duvet", { pathArray: duvetPaths, updatable: true, uvs }, scene);
    this.duvet.material = make("duvet", colour, true);
    this.fold = MeshBuilder.CreateRibbon("duvet fold", { pathArray: this.paths(1.2, COVER_TO - 0.2, COVER_TO + 0.02, 0.012), updatable: true }, scene);
    this.fold.material = make("duvet fold", "#f4f1ea");
    for (const mesh of [this.duvet, this.fold]) {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      mesh.setEnabled(false);
    }
  }

  /** Cross-sections across the bed, from `from` to `to` metres up from the soles, in the blanket's own frame (feet at z 0, head toward −z). */
  private paths(width: number, from: number, to: number, lift: number) {
    const paths: Vector3[][] = [];
    const half = width / 2;
    for (let along = from; along <= to + 1e-6; along += 0.06) {
      const rise = bodyHeight(Math.max(0, along)) + 0.02 + lift;
      const path: Vector3[] = [];
      for (let step = -14; step <= 14; step += 1) {
        const across = (step / 14) * (half + 0.18);
        const hang = Math.abs(across) > half ? -Math.min(0.24, (Math.abs(across) - half) * 1.6) : 0;
        const drape = Math.abs(across) > half ? 0.02 : 0.02 + rise * Math.exp(-((across / 0.3) ** 2));
        path.push(new Vector3(across, drape + hang, -along));
      }
      paths.push(path);
    }
    return paths;
  }

  /** Covers a body lying with its soles at `x`, `z` and head toward −(sin yaw, cos yaw), on a mattress `width` wide whose top is at `mattress`. */
  show(x: number, mattress: number, z: number, yaw: number, width = 1.2) {
    for (const [mesh, from, to, lift] of [[this.duvet, COVER_FROM, COVER_TO, 0], [this.fold, COVER_TO - 0.2, COVER_TO + 0.02, 0.012]] as const) {
      MeshBuilder.CreateRibbon(mesh.name, { pathArray: this.paths(width, from, to, lift), instance: mesh });
      mesh.position.set(x, mattress, z);
      mesh.rotation.y = yaw;
      mesh.setEnabled(true);
    }
  }

  hide() {
    this.duvet.setEnabled(false);
    this.fold.setEnabled(false);
  }

  dispose() {
    this.duvet.material?.dispose(false, true);
    this.fold.material?.dispose();
    this.duvet.dispose();
    this.fold.dispose();
  }
}

/** Indigo adire cloth: rows of pale tie-dye circles and stitched lines on the dyed ground. */
function adire(scene: Scene, ground: string) {
  const texture = new DynamicTexture("adire", { width: 256, height: 256 }, scene, true);
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.fillStyle = ground;
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = "rgba(214, 226, 240, 0.75)";
  context.fillStyle = "rgba(214, 226, 240, 0.55)";
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const [x, y] = [32 + column * 64, 32 + row * 64];
      context.lineWidth = 3;
      for (const radius of [22, 14]) {
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.stroke();
      }
      context.beginPath();
      context.arc(x, y, 5, 0, Math.PI * 2);
      context.fill();
    }
    context.lineWidth = 2;
    context.setLineDash([6, 5]);
    context.beginPath();
    context.moveTo(0, row * 64);
    context.lineTo(256, row * 64);
    context.stroke();
    context.setLineDash([]);
  }
  texture.update();
  return texture;
}
