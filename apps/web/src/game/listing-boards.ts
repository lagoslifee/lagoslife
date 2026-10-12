import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { placeById, type Vec2 } from "@lagos-living/shared";

/** What a For Sale / For Rent board says once it's no longer simply on the market; "removed" takes the board down. */
export type BoardLabel = "mine" | "sold" | "let" | "removed";
type Sign = { placeId: string; board?: { at: Vec2; yaw: number; normal: Vec2 } };

const TEXT: Record<Exclude<BoardLabel, "removed">, { text: string; fill: string }> = {
  mine: { text: "YOUR HOME", fill: "#1f8a4c" },
  sold: { text: "SOLD", fill: "#c62828" },
  let: { text: "LET", fill: "#c62828" },
};

const BOARD_W = 1.62;
const BOARD_H = BOARD_W / (512 / 96);
const BOARD_Y = 1.75;

/**
 * The For Sale / For Rent signboards outside listed homes. They are separate meshes (only a handful exist) so a board
 * can carry a SOLD strap, or come down altogether once the home is yours and nothing else in it is on the market.
 */
export class ListingBoards {
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly boards = new Map<string, { label: BoardLabel | "open"; meshes: Mesh[] }>();

  constructor(private readonly scene: Scene) {}

  update(signs: Sign[], labels: Map<string, BoardLabel>) {
    for (const sign of signs) {
      if (!sign.board) continue;
      const label = labels.get(sign.placeId) ?? "open";
      const current = this.boards.get(sign.placeId);
      if (current?.label === label) continue;
      current?.meshes.forEach((mesh) => mesh.dispose());
      this.boards.set(sign.placeId, { label, meshes: label === "removed" ? [] : this.build(sign.placeId, sign.board, label) });
    }
  }

  dispose() {
    for (const board of this.boards.values()) board.meshes.forEach((mesh) => mesh.dispose());
    this.boards.clear();
    for (const material of this.materials.values()) {
      material.diffuseTexture?.dispose();
      material.dispose();
    }
  }

  private build(placeId: string, board: { at: Vec2; yaw: number; normal: Vec2 }, label: Exclude<BoardLabel, "removed"> | "open") {
    const [nx, nz] = board.normal;
    const along: Vec2 = [-nz, nx];
    const [px, pz] = board.at;
    const meshes: Mesh[] = [];
    const steel = this.flat("listing post", "#8d939b");
    for (const side of [-0.7, 0.7]) {
      const post = MeshBuilder.CreateBox(`listing post ${placeId}`, { width: 0.07, height: 2, depth: 0.07 }, this.scene);
      post.position.set(px + along[0] * side, 1, pz + along[1] * side);
      post.rotation.y = board.yaw;
      post.material = steel;
      meshes.push(post);
    }
    const panel = MeshBuilder.CreateBox(`listing panel ${placeId}`, { width: 1.7, height: 0.4, depth: 0.04 }, this.scene);
    panel.position.set(px, BOARD_Y, pz);
    panel.rotation.y = board.yaw;
    panel.material = this.flat("listing panel", "#f2f2f2");
    meshes.push(panel);
    const place = placeById.get(placeId);
    const text = this.face(place?.kind === "rental" ? "rent" : "sale", place?.name ?? "");
    for (const side of [1, -1]) {
      const face = MeshBuilder.CreatePlane(`listing face ${placeId} ${side}`, { width: BOARD_W, height: BOARD_H }, this.scene);
      face.position.set(px + nx * 0.025 * side, BOARD_Y, pz + nz * 0.025 * side);
      // A plane's visible face looks along its local -z.
      face.rotation.y = Math.atan2(-nx * side, -nz * side);
      face.material = text;
      meshes.push(face);
      if (label === "open") continue;
      const strap = MeshBuilder.CreatePlane(`listing strap ${placeId} ${side}`, { width: 1.5, height: 0.24 }, this.scene);
      strap.material = this.strap(label);
      strap.position.set(px + nx * 0.045 * side, BOARD_Y, pz + nz * 0.045 * side);
      strap.rotation.y = Math.atan2(-nx * side, -nz * side);
      strap.rotation.z = -0.12;
      meshes.push(strap);
    }
    for (const mesh of meshes) {
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
    }
    return meshes;
  }

  private flat(key: string, colour: string) {
    let material = this.materials.get(key);
    if (material) return material;
    material = new StandardMaterial(key, this.scene);
    material.diffuseColor = Color3.FromHexString(colour);
    material.specularColor = Color3.Black();
    this.materials.set(key, material);
    return material;
  }

  private face(style: "rent" | "sale", name: string) {
    const key = `listing face ${style} ${name}`;
    let material = this.materials.get(key);
    if (material) return material;
    const texture = new DynamicTexture(key, { width: 512, height: 96 }, this.scene, true);
    const context = texture.getContext() as CanvasRenderingContext2D;
    context.fillStyle = style === "rent" ? "#d9332b" : "#1b4fa0";
    context.fillRect(0, 0, 512, 96);
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "900 44px Inter, Arial, sans-serif";
    context.fillText(style === "rent" ? "FOR RENT" : "FOR SALE", 256, 36);
    context.font = "600 20px Inter, Arial, sans-serif";
    context.fillText(name.slice(0, 40), 256, 76);
    texture.update();
    material = new StandardMaterial(key, this.scene);
    material.diffuseTexture = texture;
    material.emissiveColor = new Color3(0.3, 0.3, 0.3);
    material.specularColor = Color3.Black();
    this.materials.set(key, material);
    return material;
  }

  private strap(label: Exclude<BoardLabel, "removed">) {
    const key = `listing strap ${label}`;
    let material = this.materials.get(key);
    if (material) return material;
    const texture = new DynamicTexture(key, { width: 512, height: 82 }, this.scene, true);
    const context = texture.getContext() as CanvasRenderingContext2D;
    context.fillStyle = TEXT[label].fill;
    context.fillRect(0, 0, 512, 82);
    context.fillStyle = "#ffffff";
    context.font = "bold 58px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(TEXT[label].text, 256, 44);
    texture.update();
    material = new StandardMaterial(key, this.scene);
    material.diffuseTexture = texture;
    material.emissiveColor = new Color3(0.35, 0.35, 0.35);
    material.specularColor = Color3.Black();
    this.materials.set(key, material);
    return material;
  }
}
