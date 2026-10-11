import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { BIKE_RENTAL, BIKE_STATIONS, type BikeStation } from "@lagos-living/shared";
import type { Materials } from "./materials";
import type { VehicleFactory, VehicleView } from "./vehicles";

const SPACING = 0.9;

/** Dock racks with the bikes currently available, shown only near the player. */
export class BikeStationsView {
  private readonly stations: Array<{ station: BikeStation; root: TransformNode; bikes: VehicleView[] }> = [];

  constructor(scene: Scene, materials: Materials, groundHeight: (x: number, z: number) => number, factory: VehicleFactory, addCaster: (meshes: AbstractMesh[]) => void) {
    const brand = new PBRMaterial("bike hire yellow", scene);
    brand.albedoColor = Color3.FromHexString("#e0b02a");
    brand.roughness = 0.5;
    for (const station of BIKE_STATIONS) {
      const [x, z] = station.point;
      const y = groundHeight(x, z);
      const root = new TransformNode(`bike station ${station.id}`, scene);
      root.position.set(x, y, z);
      root.rotation.y = station.yaw;
      const length = BIKE_RENTAL.docks * SPACING + 0.8;
      const slab = MeshBuilder.CreateBox(`bike dock slab ${station.id}`, { width: 1.5, height: 0.08, depth: length }, scene);
      slab.material = materials.concrete;
      slab.position.y = 0.04;
      slab.parent = root;
      const rail = MeshBuilder.CreateBox(`bike dock rail ${station.id}`, { width: 0.08, height: 0.08, depth: length - 0.4 }, scene);
      rail.material = materials.pole;
      rail.position.set(-0.55, 0.62, 0);
      rail.parent = root;
      for (let index = 0; index < BIKE_RENTAL.docks; index += 1) {
        const post = MeshBuilder.CreateBox(`bike dock post ${station.id}`, { width: 0.1, height: 0.62, depth: 0.1 }, scene);
        post.material = materials.pole;
        post.position.set(-0.55, 0.31, (index - (BIKE_RENTAL.docks - 1) / 2) * SPACING);
        post.parent = root;
      }
      const totem = MeshBuilder.CreateBox(`bike hire totem ${station.id}`, { width: 0.18, height: 2.2, depth: 0.5 }, scene);
      totem.material = brand;
      totem.position.set(-0.55, 1.1, length / 2 + 0.2);
      totem.parent = root;
      for (const mesh of root.getChildMeshes()) {
        mesh.isPickable = false;
        mesh.freezeWorldMatrix();
      }
      const bikes: VehicleView[] = [];
      for (let index = 0; index < BIKE_RENTAL.docks; index += 1) {
        const view = factory.create(`dock ${station.id} ${index}`, BIKE_RENTAL.modelId, BIKE_RENTAL.colour);
        const along = (index - (BIKE_RENTAL.docks - 1) / 2) * SPACING;
        const bx = x + Math.sin(station.yaw) * along;
        const bz = z + Math.cos(station.yaw) * along;
        view.setPose(bx, groundHeight(bx, bz), bz, station.yaw - Math.PI / 2);
        addCaster(view.meshes);
        bikes.push(view);
      }
      this.stations.push({ station, root, bikes });
    }
  }

  /** Shows `stock` docked bikes per station; stations far from the camera are hidden entirely. */
  update(stock: Record<string, number>, x: number, z: number, hidden: boolean) {
    for (const { station, root, bikes } of this.stations) {
      const near = !hidden && Math.hypot(station.point[0] - x, station.point[1] - z) < 220;
      root.setEnabled(near);
      const count = stock[station.id] ?? BIKE_RENTAL.startingBikes;
      bikes.forEach((bike, index) => {
        bike.root.setEnabled(near && index < count);
        if (near) bike.setDetail(Math.hypot(bike.x - x, bike.z - z) < 30);
      });
    }
  }
}
