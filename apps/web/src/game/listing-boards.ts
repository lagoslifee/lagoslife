import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { Vec2 } from "@lagos-living/shared";

/** What a For Sale / For Rent board says once it's no longer simply on the market. */
export type BoardLabel = "mine" | "sold" | "let";
type Sign = { placeId: string; board?: { at: Vec2; yaw: number; normal: Vec2 } };

const TEXT: Record<BoardLabel, { text: string; fill: string }> = {
  mine: { text: "YOUR HOME", fill: "#1f8a4c" },
  sold: { text: "SOLD", fill: "#c62828" },
  let: { text: "LET", fill: "#c62828" },
};

/** Straps pasted across the signboards of homes that are yours or already taken, so nothing you own looks for sale. */
export class ListingBoards {
  private readonly materials = new Map<BoardLabel, StandardMaterial>();
  private readonly straps = new Map<string, { label: BoardLabel; meshes: Mesh[] }>();

  constructor(private readonly scene: Scene) {}

  update(signs: Sign[], labels: Map<string, BoardLabel>) {
    const shown = new Set<string>();
    for (const sign of signs) {
      const label = labels.get(sign.placeId);
      if (!sign.board || !label) continue;
      shown.add(sign.placeId);
      const current = this.straps.get(sign.placeId);
      if (current?.label === label) continue;
      current?.meshes.forEach((mesh) => mesh.dispose());
      this.straps.set(sign.placeId, { label, meshes: this.build(sign.placeId, sign.board, label) });
    }
    for (const [placeId, strap] of this.straps) {
      if (shown.has(placeId)) continue;
      strap.meshes.forEach((mesh) => mesh.dispose());
      this.straps.delete(placeId);
    }
  }

  dispose() {
    for (const strap of this.straps.values()) strap.meshes.forEach((mesh) => mesh.dispose());
    this.straps.clear();
    for (const material of this.materials.values()) {
      material.diffuseTexture?.dispose();
      material.dispose();
    }
  }

  private build(placeId: string, board: { at: Vec2; normal: Vec2 }, label: BoardLabel) {
    const material = this.material(label);
    const [nx, nz] = board.normal;
    return [1, -1].map((side) => {
      const strap = MeshBuilder.CreatePlane(`listing strap ${placeId} ${side}`, { width: 1.5, height: 0.24 }, this.scene);
      strap.material = material;
      strap.isPickable = false;
      strap.position.set(board.at[0] + nx * 0.045 * side, 1.75, board.at[1] + nz * 0.045 * side);
      // A plane's visible face looks along its local -z.
      strap.rotation.y = Math.atan2(-nx * side, -nz * side);
      strap.rotation.z = -0.12;
      return strap;
    });
  }

  private material(label: BoardLabel) {
    let material = this.materials.get(label);
    if (material) return material;
    const texture = new DynamicTexture(`listing strap ${label}`, { width: 512, height: 82 }, this.scene, true);
    const context = texture.getContext() as CanvasRenderingContext2D;
    context.fillStyle = TEXT[label].fill;
    context.fillRect(0, 0, 512, 82);
    context.fillStyle = "#ffffff";
    context.font = "bold 58px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(TEXT[label].text, 256, 44);
    texture.update();
    material = new StandardMaterial(`listing strap ${label}`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveColor = new Color3(0.35, 0.35, 0.35);
    material.specularColor = Color3.Black();
    this.materials.set(label, material);
    return material;
  }
}
