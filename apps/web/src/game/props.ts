import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { MeshoptCompression } from "@babylonjs/core/Meshes/Compression/meshoptCompression";

MeshoptCompression.Configuration = { decoder: { url: "/vendor/meshopt_decoder.js" } };

/** Meshy-generated furniture (see scripts/assets/build-meshy-props.mjs): front faces +Z, base on the ground. */
export type PropId = "immigration-booth" | "checkin-counter" | "restaurant-table";
const PROP_IDS: PropId[] = ["immigration-booth", "checkin-counter", "restaurant-table"];

/**
 * Loads each prop once; `place` makes cheap instanced copies. Missing or failed files are skipped so the caller keeps
 * drawing its simple box version instead.
 */
export class PropLibrary {
  private readonly containers = new Map<PropId, AssetContainer>();

  static async load(scene: Scene) {
    const library = new PropLibrary();
    await Promise.all(
      PROP_IDS.map(async (id) => {
        try {
          library.containers.set(id, await LoadAssetContainerAsync(`/assets/props/${id}-v1.glb`, scene));
        } catch {
          // Keep the box fallback for this prop.
        }
      }),
    );
    return library;
  }

  has(id: PropId) {
    return this.containers.has(id);
  }

  place(id: PropId, x: number, z: number, yaw: number, disposables: Array<{ dispose(): void }>, y = 0) {
    const container = this.containers.get(id);
    if (!container) return null;
    const copy = container.instantiateModelsToScene((name) => `${id} ${name}`, false, { doNotInstantiate: false });
    const root = new TransformNode(`prop ${id}`, container.scene);
    for (const node of copy.rootNodes) node.parent = root;
    root.position.set(x, y, z);
    root.rotation.y = yaw;
    for (const mesh of root.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
    }
    disposables.push(root, { dispose: () => copy.dispose() });
    return root;
  }
}
