import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";
import earcut from "earcut";

export type V3 = [number, number, number];

/** Collects many quads/boxes into one mesh so a whole district is a few draw calls. */
export class MeshBuilderBatch {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  private useColors = false;

  constructor(readonly name: string) {}

  get vertexCount() {
    return this.positions.length / 3;
  }

  private push(p: V3, n: V3, uv: [number, number], color: [number, number, number, number]) {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    this.uvs.push(uv[0], uv[1]);
    this.colors.push(color[0], color[1], color[2], color[3]);
  }

  /**
   * Adds quad p0-p1-p2-p3 facing `normal`. Winding is chosen to match
   * Babylon's front-face convention so back-face culling stays enabled.
   */
  quad(
    p0: V3,
    p1: V3,
    p2: V3,
    p3: V3,
    normal: V3,
    uv: [[number, number], [number, number], [number, number], [number, number]],
    color?: [number, number, number],
  ) {
    const rgba: [number, number, number, number] = color ? [color[0], color[1], color[2], 1] : [1, 1, 1, 1];
    if (color) this.useColors = true;
    const start = this.vertexCount;
    this.push(p0, normal, uv[0], rgba);
    this.push(p1, normal, uv[1], rgba);
    this.push(p2, normal, uv[2], rgba);
    this.push(p3, normal, uv[3], rgba);
    // Babylon's ComputeNormals uses (p1 - p2) x (p3 - p2) per triangle.
    const ax = p0[0] - p1[0];
    const ay = p0[1] - p1[1];
    const az = p0[2] - p1[2];
    const bx = p2[0] - p1[0];
    const by = p2[1] - p1[1];
    const bz = p2[2] - p1[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const facing = nx * normal[0] + ny * normal[1] + nz * normal[2];
    if (facing >= 0) this.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    else this.indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
  }

  triangle(p0: V3, p1: V3, p2: V3, normal: V3, uv: [[number, number], [number, number], [number, number]], color?: [number, number, number]) {
    const rgba: [number, number, number, number] = color ? [color[0], color[1], color[2], 1] : [1, 1, 1, 1];
    if (color) this.useColors = true;
    const start = this.vertexCount;
    this.push(p0, normal, uv[0], rgba);
    this.push(p1, normal, uv[1], rgba);
    this.push(p2, normal, uv[2], rgba);
    const ax = p0[0] - p1[0];
    const ay = p0[1] - p1[1];
    const az = p0[2] - p1[2];
    const bx = p2[0] - p1[0];
    const by = p2[1] - p1[1];
    const bz = p2[2] - p1[2];
    const facing =
      (ay * bz - az * by) * normal[0] + (az * bx - ax * bz) * normal[1] + (ax * by - ay * bx) * normal[2];
    if (facing >= 0) this.indices.push(start, start + 1, start + 2);
    else this.indices.push(start, start + 2, start + 1);
  }

  /** Vertical wall from (x0,z0) to (x1,z1), outward normal on the right of travel. */
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tile = 3, color?: [number, number, number], uOffset = 0) {
    const length = Math.hypot(x1 - x0, z1 - z0);
    if (length < 0.01) return;
    const normal: V3 = [(z1 - z0) / length, 0, -(x1 - x0) / length];
    const u0 = uOffset / tile;
    const u1 = (uOffset + length) / tile;
    this.quad(
      [x0, y0, z0],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z0],
      normal,
      [[u0, y0 / tile], [u1, y0 / tile], [u1, y1 / tile], [u0, y1 / tile]],
      color,
    );
  }

  /** Oriented box centred at (cx, cy, cz), rotated by yaw around Y. */
  box(cx: number, cy: number, cz: number, width: number, height: number, depth: number, yaw = 0, tile = 1, color?: [number, number, number], open = false) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const corner = (x: number, y: number, z: number): V3 => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const hw = width / 2;
    const hh = height / 2;
    const hd = depth / 2;
    const rot = (x: number, z: number): V3 => [x * c + z * s, 0, -x * s + z * c];
    const faces: Array<[V3, V3, V3, V3, V3, number, number]> = [
      [corner(-hw, -hh, hd), corner(hw, -hh, hd), corner(hw, hh, hd), corner(-hw, hh, hd), rot(0, 1), width, height],
      [corner(hw, -hh, -hd), corner(-hw, -hh, -hd), corner(-hw, hh, -hd), corner(hw, hh, -hd), rot(0, -1), width, height],
      [corner(hw, -hh, hd), corner(hw, -hh, -hd), corner(hw, hh, -hd), corner(hw, hh, hd), rot(1, 0), depth, height],
      [corner(-hw, -hh, -hd), corner(-hw, -hh, hd), corner(-hw, hh, hd), corner(-hw, hh, -hd), rot(-1, 0), depth, height],
      [corner(-hw, hh, hd), corner(hw, hh, hd), corner(hw, hh, -hd), corner(-hw, hh, -hd), [0, 1, 0], width, depth],
      [corner(-hw, -hh, -hd), corner(hw, -hh, -hd), corner(hw, -hh, hd), corner(-hw, -hh, hd), [0, -1, 0], width, depth],
    ];
    for (const [faceIndex, [a, b, d, e, n, u, v]] of faces.entries()) {
      // Open boxes skip the back (-Z) and bottom faces that sit against walls or floors.
      if (open && (faceIndex === 1 || faceIndex === 5)) continue;
      this.quad(a, b, d, e, n, [[0, 0], [u / tile, 0], [u / tile, v / tile], [0, v / tile]], color);
    }
  }

  /** Horizontal polygon (CCW or CW ring) triangulated with earcut, world-space UVs. */
  polygon(points: Array<[number, number]>, y: number, tile: number, color?: [number, number, number], down = false) {
    if (points.length < 3) return;
    const flat = points.flatMap(([x, z]) => [x, z]);
    const triangles = earcut(flat);
    const normal: V3 = down ? [0, -1, 0] : [0, 1, 0];
    for (let index = 0; index < triangles.length; index += 3) {
      const a = points[triangles[index]!]!;
      const b = points[triangles[index + 1]!]!;
      const c = points[triangles[index + 2]!]!;
      this.triangle(
        [a[0], y, a[1]],
        [b[0], y, b[1]],
        [c[0], y, c[1]],
        normal,
        [[a[0] / tile, a[1] / tile], [b[0] / tile, b[1] / tile], [c[0] / tile, c[1] / tile]],
        color,
      );
    }
  }

  /** Ribbon whose UVs come from world X/Z so overlapping strips texture identically. */
  worldRibbon(points: Array<[number, number]>, left: number, right: number, y: number, tile: number, color?: [number, number, number]) {
    const start = this.uvs.length;
    this.ribbon(points, left, right, y, tile, color);
    for (let index = start, vertex = start / 2; index < this.uvs.length; index += 2, vertex += 1) {
      this.uvs[index] = this.positions[vertex * 3]! / tile;
      this.uvs[index + 1] = this.positions[vertex * 3 + 2]! / tile;
    }
  }

  /** Vertical strip along a polyline at a lateral offset; faces right of travel unless `faceLeft`. */
  curtain(points: Array<[number, number]>, offset: number, y0: number, y1: number, tile: number, faceLeft = false, color?: [number, number, number]) {
    const shifted = offsetPolyline(points, offset);
    let u = 0;
    for (let index = 1; index < shifted.length; index += 1) {
      const a = faceLeft ? shifted[index]! : shifted[index - 1]!;
      const b = faceLeft ? shifted[index - 1]! : shifted[index]!;
      this.wall(a[0], a[1], b[0], b[1], y0, y1, tile, color, u);
      u += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
  }

  /** Flat horizontal ribbon along a polyline (roads, kerbs, drains). */
  ribbon(points: Array<[number, number]>, left: number, right: number, y: number, tile: number, color?: [number, number, number]) {
    if (points.length < 2) return;
    let distance = 0;
    const offsets = points.map((point, index) => {
      const a = points[Math.max(0, index - 1)]!;
      const b = points[Math.min(points.length - 1, index + 1)]!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(dx, dz) || 1;
      return { point, rx: dz / length, rz: -dx / length };
    });
    for (let index = 1; index < offsets.length; index += 1) {
      const a = offsets[index - 1]!;
      const b = offsets[index]!;
      const segment = Math.hypot(b.point[0] - a.point[0], b.point[1] - a.point[1]);
      const u0 = distance / tile;
      const u1 = (distance + segment) / tile;
      distance += segment;
      this.quad(
        [a.point[0] + a.rx * left, y, a.point[1] + a.rz * left],
        [a.point[0] + a.rx * right, y, a.point[1] + a.rz * right],
        [b.point[0] + b.rx * right, y, b.point[1] + b.rz * right],
        [b.point[0] + b.rx * left, y, b.point[1] + b.rz * left],
        [0, 1, 0],
        [[left / tile, u0], [right / tile, u0], [right / tile, u1], [left / tile, u1]],
        color,
      );
    }
  }

  build(scene: Scene, material: Material) {
    if (this.vertexCount === 0) return null;
    const mesh = new Mesh(this.name, scene);
    const data = new VertexData();
    data.positions = this.positions;
    data.normals = this.normals;
    data.uvs = this.uvs;
    data.indices = this.indices;
    if (this.useColors) data.colors = this.colors;
    data.applyToMesh(mesh, false);
    mesh.material = material;
    if (this.useColors) mesh.useVertexColors = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    return mesh;
  }
}

/** Offsets a polyline sideways; positive offsets move to the right of travel. */
export function offsetPolyline(points: Array<[number, number]>, offset: number): Array<[number, number]> {
  return points.map((point, index) => {
    const a = points[Math.max(0, index - 1)]!;
    const b = points[Math.min(points.length - 1, index + 1)]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz) || 1;
    return [point[0] + (dz / length) * offset, point[1] - (dx / length) * offset];
  });
}

/** Inserts points so no segment is longer than `step` metres. */
export function densify(points: Array<[number, number]>, step: number): Array<[number, number]> {
  const out: Array<[number, number]> = [points[0]!];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const pieces = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let piece = 1; piece <= pieces; piece += 1) {
      const t = piece / pieces;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export function polylineLength(points: Array<[number, number]>) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
  }
  return total;
}

/** Point and unit direction at chainage `s` along a polyline. */
export function pointAt(points: Array<[number, number]>, s: number) {
  let remaining = Math.max(0, s);
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (remaining <= length || index === points.length - 1) {
      const t = length > 0 ? Math.min(1, remaining / length) : 0;
      return {
        x: a[0] + (b[0] - a[0]) * t,
        z: a[1] + (b[1] - a[1]) * t,
        dx: length > 0 ? (b[0] - a[0]) / length : 1,
        dz: length > 0 ? (b[1] - a[1]) / length : 0,
      };
    }
    remaining -= length;
  }
  const last = points.at(-1)!;
  return { x: last[0], z: last[1], dx: 1, dz: 0 };
}

/** Sub-polyline between chainages s0 and s1. */
export function slicePolyline(points: Array<[number, number]>, s0: number, s1: number) {
  const out: Array<[number, number]> = [];
  const start = pointAt(points, s0);
  out.push([start.x, start.z]);
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    travelled += Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (travelled > s0 && travelled < s1) out.push([b[0], b[1]]);
  }
  const end = pointAt(points, s1);
  out.push([end.x, end.z]);
  return out;
}

export function hash(value: number) {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967295;
}
