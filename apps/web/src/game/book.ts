import type { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Avatar } from "./avatar";

/** Novels on the shelf at home, with their cover colours. */
export const BOOKS = [
  { title: "Things Fall Apart", author: "Chinua Achebe", cover: "#b5462a" },
  { title: "Half of a Yellow Sun", author: "Chimamanda Ngozi Adichie", cover: "#e2a417" },
  { title: "The Famished Road", author: "Ben Okri", cover: "#1f5e7a" },
  { title: "Purple Hibiscus", author: "Chimamanda Ngozi Adichie", cover: "#6b2c78" },
  { title: "Death and the King's Horseman", author: "Wole Soyinka", cover: "#2d6a3e" },
] as const;

const PAGE: [number, number] = [0.15, 0.22];

/**
 * An open paperback held in both hands, pages toward the reader's face. A page turns every so often. Call `follow`
 * after the avatar's reading pose is set each frame.
 */
export class Book {
  private readonly root: TransformNode;
  private readonly meshes: Mesh[] = [];
  private readonly turning: TransformNode;

  constructor(scene: Scene, cover: string) {
    this.root = new TransformNode("book", scene);
    const material = (name: string, hex: string) => {
      const found = new StandardMaterial(name, scene);
      found.diffuseColor = Color3.FromHexString(hex);
      found.specularColor = new Color3(0.08, 0.08, 0.08);
      return found;
    };
    const coverMaterial = material("book cover", cover);
    const paper = material("book pages", "#f3ecdc");
    for (const side of [-1, 1]) {
      // Each half of the spread opens a little toward the reader, like a book held in two hands.
      const half = new TransformNode("book half", scene);
      half.parent = this.root;
      half.rotation.y = -side * 0.32;
      const board = MeshBuilder.CreateBox("book board", { width: PAGE[0] + 0.006, height: PAGE[1] + 0.008, depth: 0.004 }, scene);
      board.material = coverMaterial;
      board.parent = half;
      board.position.set((side * (PAGE[0] + 0.006)) / 2, 0, -0.012);
      const pages = MeshBuilder.CreateBox("book pages", { width: PAGE[0], height: PAGE[1], depth: 0.018 }, scene);
      pages.material = paper;
      pages.parent = half;
      pages.position.set((side * PAGE[0]) / 2, 0, 0);
      this.meshes.push(board, pages);
    }
    this.turning = new TransformNode("book page", scene);
    this.turning.parent = this.root;
    const leaf = MeshBuilder.CreatePlane("book leaf", { width: PAGE[0], height: PAGE[1] - 0.004, sideOrientation: 2 }, scene);
    leaf.material = paper;
    leaf.parent = this.turning;
    leaf.position.x = PAGE[0] / 2;
    leaf.position.z = 0.0095;
    this.meshes.push(leaf);
    for (const mesh of this.meshes) mesh.isPickable = false;
  }

  /** Between the reader's hands, facing their eyes; `time` (seconds) turns a page every eight seconds. */
  follow(avatar: Avatar, time: number) {
    const grips = avatar.grips();
    const head = avatar.headPoint();
    const shown = Boolean(grips && head) && avatar.root.isEnabled();
    this.root.setEnabled(shown);
    if (!grips || !head) return;
    const mid = grips.left.add(grips.right).scaleInPlace(0.5);
    const toEyes = head.eyes.subtract(mid).normalize();
    const up = head.up.subtract(toEyes.scale(Vector3.Dot(head.up, toEyes))).normalize();
    const across = Vector3.Cross(up, toEyes).normalize();
    this.root.position.copyFrom(mid.add(up.scale(0.07)));
    this.root.rotation.copyFrom(Vector3.RotationFromAxis(across, up, toEyes));
    const phase = (time % 8) / 8;
    // The leaf lies on the right-hand page, then swings over to the left in the last second.
    this.turning.rotation.y = -0.32 - (phase < 0.88 ? 0 : Math.min(1, (phase - 0.88) / 0.1) * (Math.PI - 0.64));
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.material?.dispose();
      mesh.dispose();
    }
    this.turning.dispose();
    this.root.dispose();
  }
}
