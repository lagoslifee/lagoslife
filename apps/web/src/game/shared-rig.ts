import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";

const TOLERANCE = 1e-4;

/**
 * The character files bind every skinned part (body, brows, eyes, outfit, each hairstyle) to its own copy of the same rig,
 * differing only by a fixed offset, so each avatar evaluated ten skeletons a frame. Baking that offset into each part's
 * vertices lets every part ride the body's skeleton: one rig per person, a tenth of the bone work and bone textures.
 * Parts that don't line up exactly with the body's rig are left as they were.
 */
export function shareBodyRig(container: AssetContainer) {
  const skinned = container.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && Boolean(mesh.skeleton));
  const rig = skinned.find((mesh) => /(^|:)Body$/.test(mesh.name))?.skeleton;
  if (!rig) return 0;
  const byName = new Map(rig.bones.map((bone) => [bone.name, bone]));
  const inverses = new Map(rig.bones.map((bone) => [bone, Matrix.Invert(bone.getAbsoluteInverseBindMatrix())]));
  const retired = new Set<Skeleton>();
  let moved = 0;
  for (const mesh of skinned) {
    const own = mesh.skeleton!;
    if (own === rig || own.bones.length !== rig.bones.length || mesh.morphTargetManager) continue;
    let offset: Matrix | null = null;
    for (const bone of own.bones) {
      const match = byName.get(bone.name);
      if (!match) {
        offset = null;
        break;
      }
      const candidate = bone.getAbsoluteInverseBindMatrix().multiply(inverses.get(match)!);
      if (!offset) offset = candidate;
      else if (candidate.m.some((value, index) => Math.abs(value - offset!.m[index]!) > TOLERANCE)) {
        offset = null;
        break;
      }
    }
    if (!offset || !bake(mesh, offset)) continue;
    mesh.skeleton = rig;
    retired.add(own);
    moved += 1;
  }
  for (const skeleton of retired) {
    if (container.meshes.some((mesh) => mesh.skeleton === skeleton)) continue;
    container.skeletons.splice(container.skeletons.indexOf(skeleton), 1);
    skeleton.dispose();
  }
  return moved;
}

function bake(mesh: Mesh, offset: Matrix) {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind, true, true);
  if (!positions) return false;
  const point = new Vector3();
  for (let index = 0; index < positions.length; index += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(positions[index]!, positions[index + 1]!, positions[index + 2]!, offset, point);
    positions[index] = point.x;
    positions[index + 1] = point.y;
    positions[index + 2] = point.z;
  }
  mesh.setVerticesData(VertexBuffer.PositionKind, Float32Array.from(positions), false, 3);
  for (const [kind, stride] of [[VertexBuffer.NormalKind, 3], [VertexBuffer.TangentKind, 4]] as const) {
    const data = mesh.getVerticesData(kind, true, true);
    if (!data) continue;
    for (let index = 0; index < data.length; index += stride) {
      Vector3.TransformNormalFromFloatsToRef(data[index]!, data[index + 1]!, data[index + 2]!, offset, point);
      point.normalize();
      data[index] = point.x;
      data[index + 1] = point.y;
      data[index + 2] = point.z;
    }
    mesh.setVerticesData(kind, Float32Array.from(data), false, stride);
  }
  mesh.refreshBoundingInfo();
  return true;
}
