import { Mesh } from "@babylonjs/core/Meshes/mesh";

/**
 * Babylon rebuilds a per-vertex Vector3 array on every clone when it refreshes the bounding box. Thousands of cloned
 * cars, avatars and props each kept their own copy (hundreds of MB on a phone, enough for iOS to kill the tab). Without
 * it a mesh falls back to its shared geometry's points, which Babylon generates on demand for picking and collisions.
 */
const refresh = Mesh.prototype.refreshBoundingInfo;
Mesh.prototype.refreshBoundingInfo = function (this: Mesh, ...args: Parameters<typeof refresh>) {
  const result = refresh.apply(this, args);
  (this as unknown as { _internalAbstractMeshDataInfo: { _positions: unknown } })._internalAbstractMeshDataInfo._positions = null;
  return result;
};
