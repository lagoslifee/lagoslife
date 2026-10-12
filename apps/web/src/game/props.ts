import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { MeshoptCompression } from "@babylonjs/core/Meshes/Compression/meshoptCompression";

MeshoptCompression.Configuration = { decoder: { url: "/vendor/meshopt_decoder.js" } };

/** Meshy-generated furniture (see scripts/assets/build-meshy-props.mjs): front faces +Z, base on the ground. */
export type PropId =
  | "immigration-booth"
  | "checkin-counter"
  | "restaurant-table"
  | "treadmill"
  | "weight-bench"
  | "dumbbell-rack"
  | "generator"
  | "double-bed"
  | "sofa"
  | "dining-set"
  | "gas-cooker"
  | "standing-fan"
  | "king-bed"
  | "sectional"
  | "armchair"
  | "coffee-table"
  | "side-table"
  | "tv-console"
  | "wardrobe"
  | "bookshelf"
  | "work-desk"
  | "floor-lamp"
  | "potted-palm"
  | "kitchen-wall"
  | "kitchen-island"
  | "grand-piano"
  | "chandelier"
  | "wall-art"
  | "console-vase"
  | "helicopter";
/** Props the street and airports use everywhere; the rest load the first time something asks for them. */
const STARTUP_PROPS: PropId[] = ["immigration-booth", "checkin-counter", "restaurant-table"];

/**
 * Loads each prop once; `place` makes cheap instanced copies. Missing or failed files are skipped so the caller keeps
 * drawing its simple box version instead.
 */
export class PropLibrary {
  private readonly containers = new Map<PropId, AssetContainer>();
  private readonly loading = new Map<PropId, Promise<void>>();

  private constructor(private readonly scene: Scene) {}

  static async load(scene: Scene, ids: PropId[] = STARTUP_PROPS) {
    const library = new PropLibrary(scene);
    await library.ensure(ids);
    return library;
  }

  /** Loads any of these props not loaded yet; resolves once each has loaded or failed. */
  ensure(ids: readonly PropId[]) {
    return Promise.all(
      ids.map((id) => {
        let pending = this.loading.get(id);
        if (!pending) {
          pending = LoadAssetContainerAsync(`/assets/props/${id}-v1.glb`, this.scene).then(
            (container) => void this.containers.set(id, container),
            () => undefined,
          );
          this.loading.set(id, pending);
        }
        return pending;
      }),
    ).then(() => undefined);
  }

  has(id: PropId) {
    return this.containers.has(id);
  }

  place(id: PropId, x: number, z: number, yaw: number, disposables: Array<{ dispose(): void }>, y = 0, scale = 1) {
    const container = this.containers.get(id);
    if (!container) return null;
    const copy = container.instantiateModelsToScene((name) => `${id} ${name}`, false, { doNotInstantiate: false });
    const root = new TransformNode(`prop ${id}`, container.scene);
    for (const node of copy.rootNodes) node.parent = root;
    root.position.set(x, y, z);
    root.rotation.y = yaw;
    root.scaling.setAll(scale);
    for (const mesh of root.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
    }
    disposables.push(root, { dispose: () => copy.dispose() });
    return root;
  }
}
