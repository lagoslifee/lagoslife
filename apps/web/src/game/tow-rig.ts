import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { WorldVehicle } from "@lagos-living/shared";
import type { VehicleFactory, VehicleView } from "./vehicles";

const DECK_TOP = 1.2;
const DECK_LENGTH = 5.4;
const DECK_FRONT = -0.2;

let shared: { deck: StandardMaterial; beacon: StandardMaterial; frame: StandardMaterial } | null = null;

function materials(scene: Scene) {
  if (shared && shared.deck.getScene() === scene) return shared;
  const make = (name: string, hex: string, emissive?: string) => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = Color3.FromHexString(hex);
    material.specularColor = new Color3(0.15, 0.15, 0.15);
    if (emissive) material.emissiveColor = Color3.FromHexString(emissive);
    return material;
  };
  shared = { deck: make("tow deck", "#3b3f44"), beacon: make("tow beacon", "#ffb000", "#ff9a00"), frame: make("tow frame", "#1c1d20") };
  return shared;
}

/** Flatbed, winch frame and amber beacons on a recovery truck, plus the car it is carrying. */
export class TowRig {
  private root: TransformNode;
  private parts: Mesh[] = [];
  private beacons: Mesh[] = [];
  private carried: VehicleView | null = null;
  private carriedKey = "";
  private time = 0;

  constructor(private readonly truck: VehicleView, private readonly factory: VehicleFactory) {
    const scene = truck.root.getScene();
    const look = materials(scene);
    this.root = new TransformNode(`${truck.id} tow rig`, scene);
    this.root.parent = truck.body;
    const width = truck.model.width + 0.2;
    const deck = MeshBuilder.CreateBox(`${truck.id} deck`, { width, height: 0.16, depth: DECK_LENGTH }, scene);
    deck.position.set(0, DECK_TOP - 0.08, DECK_FRONT - DECK_LENGTH / 2);
    deck.material = look.deck;
    const headboard = MeshBuilder.CreateBox(`${truck.id} headboard`, { width, height: 0.9, depth: 0.12 }, scene);
    headboard.position.set(0, DECK_TOP + 0.45, DECK_FRONT);
    headboard.material = look.frame;
    const bar = MeshBuilder.CreateBox(`${truck.id} light bar`, { width: 1.2, height: 0.1, depth: 0.25 }, scene);
    bar.position.set(0, truck.model.height + 0.06, 0.55);
    bar.material = look.frame;
    for (const side of [-1, 1]) {
      const beacon = MeshBuilder.CreateBox(`${truck.id} beacon`, { width: 0.32, height: 0.14, depth: 0.22 }, scene);
      beacon.position.set(side * 0.42, truck.model.height + 0.17, 0.55);
      beacon.material = look.beacon;
      this.beacons.push(beacon);
    }
    this.parts.push(deck, headboard, bar, ...this.beacons);
    for (const part of this.parts) {
      part.parent = this.root;
      part.isPickable = false;
    }
  }

  get meshes() {
    return [...this.parts, ...(this.carried?.meshes ?? [])];
  }

  update(dt: number, tow: NonNullable<WorldVehicle["tow"]>) {
    this.time += dt;
    const flash = Math.floor(this.time * 3) % 2 === 0;
    this.beacons[0]?.setEnabled(flash);
    this.beacons[1]?.setEnabled(!flash);
    const key = tow.carrying ? `${tow.carrying.modelId}|${tow.carrying.colour}` : "";
    if (key !== this.carriedKey) {
      this.carried?.dispose();
      this.carried = null;
      this.carriedKey = key;
      if (tow.carrying) {
        this.carried = this.factory.create(`${this.truck.id} load`, tow.carrying.modelId, tow.carrying.colour);
        this.carried.root.parent = this.root;
      }
    }
    if (!this.carried) return;
    // Winched up a ramp off the back of the deck, then level on it.
    const down = 1 - Math.max(0, Math.min(1, tow.lift));
    const centre = DECK_FRONT - DECK_LENGTH / 2 - 0.2;
    this.carried.root.position.set(0, DECK_TOP * (1 - down), centre - down * (this.carried.model.length * 0.6));
    this.carried.root.rotation.set(-down * 0.22, 0, 0);
  }

  dispose() {
    this.carried?.dispose();
    this.root.dispose(false, false);
  }
}
