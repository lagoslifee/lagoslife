import type { Place, Vec2 } from "@lagos-living/shared";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { PropLibrary } from "./props";

/**
 * The broken generator for a repair gig: stands beside the place's door, toward the street. The worker stands at
 * `stand` facing it. Once it runs it shakes and the work lamp over the door lights up.
 */
export class RepairSite {
  readonly at: Vec2;
  readonly stand: Vec2;
  readonly faceYaw: number;
  private readonly root: TransformNode;
  private readonly lamp: StandardMaterial;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private running = false;
  private baseY: number;

  constructor(scene: Scene, props: PropLibrary | null, place: Place, groundHeight: (x: number, z: number) => number) {
    const dx = place.kerb[0] - place.door[0];
    const dz = place.kerb[1] - place.door[1];
    const length = Math.hypot(dx, dz) || 1;
    const [fx, fz] = [dx / length, dz / length];
    const [lx, lz] = [-fz, fx];
    const out = Math.min(2.4, length * 0.4);
    this.at = [place.door[0] + fx * out + lx * 2.6, place.door[1] + fz * out + lz * 2.6];
    this.stand = [this.at[0] - lx * 1.35, this.at[1] - lz * 1.35];
    this.faceYaw = Math.atan2(lx, lz);
    this.baseY = groundHeight(this.at[0], this.at[1]);
    this.root = new TransformNode("repair generator", scene);
    this.root.position.set(this.at[0], this.baseY, this.at[1]);
    this.root.rotation.y = Math.atan2(-lx, -lz);
    this.disposables.push(this.root);

    const fallback = MeshBuilder.CreateBox("repair generator body", { width: 1.1, height: 0.75, depth: 0.7 }, scene);
    fallback.position.y = 0.375;
    const paint = new StandardMaterial("repair generator paint", scene);
    paint.diffuseColor = new Color3(0.85, 0.55, 0.1);
    fallback.material = paint;
    fallback.parent = this.root;
    fallback.isPickable = false;
    this.disposables.push(fallback, paint);
    if (props) {
      void props.ensure(["generator"]).then(() => {
        if (!this.root.isDisposed() && props.has("generator")) {
          const model = props.place("generator", 0, 0, 0, this.disposables);
          if (!model) return;
          model.parent = this.root;
          for (const mesh of model.getChildMeshes()) mesh.unfreezeWorldMatrix();
          fallback.setEnabled(false);
        }
      });
    }

    const lampX = place.door[0] + fx * 0.3;
    const lampZ = place.door[1] + fz * 0.3;
    const bulb = MeshBuilder.CreateSphere("repair work lamp", { diameter: 0.28, segments: 8 }, scene);
    bulb.position.set(lampX, groundHeight(lampX, lampZ) + 2.7, lampZ);
    bulb.isPickable = false;
    this.lamp = new StandardMaterial("repair work lamp glass", scene);
    this.lamp.diffuseColor = new Color3(0.3, 0.3, 0.28);
    this.lamp.specularColor = Color3.Black();
    bulb.material = this.lamp;
    this.disposables.push(bulb, this.lamp);
  }

  setRunning(running: boolean) {
    this.running = running;
    this.lamp.emissiveColor = running ? new Color3(1, 0.92, 0.6) : Color3.Black();
    if (!running) this.root.position.y = this.baseY;
  }

  update(time: number) {
    if (!this.running) return;
    this.root.position.y = this.baseY + Math.abs(Math.sin(time * 70)) * 0.012;
    this.root.rotation.z = Math.sin(time * 53) * 0.006;
  }

  dispose() {
    for (const item of this.disposables.reverse()) item.dispose();
    this.disposables.length = 0;
  }
}
