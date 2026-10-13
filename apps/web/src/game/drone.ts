import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { houseDesign, plotDesignId, plotForHome, propertyPlace, type Vec2 } from "@lagos-living/shared";

export type Bay = { x: number; z: number; yaw: number };
/** What the drone circles: the middle of the house, how big it is, and where the owner's cars line up. */
export type DroneSite = { centre: Vec2; radius: number; bays: Bay[] };

const BAY = 5.4;
const KERB_GAP = 5.8;

/** Cars along the kerb in front of the door, nose along the near lane, centred on the door. */
function kerbBays(kerb: Vec2, yaw: number, count: number, from = 0): Bay[] {
  const [ax, az] = [Math.sin(yaw), Math.cos(yaw)];
  return Array.from({ length: count }, (_, index) => {
    const offset = (index + from - (count + from - 1) / 2) * KERB_GAP;
    return { x: kerb[0] + ax * offset, z: kerb[1] + az * offset, yaw };
  });
}

/**
 * Where a home is and where `count` cars park at it. Built houses fill their carports first (nose to the street,
 * both sides of the house when it has them) and line the rest up at the kerb; flats and listed houses use the kerb.
 */
export function droneSite(propertyId: string, count: number): DroneSite | null {
  const plot = plotForHome(propertyId);
  if (plot) {
    const design = houseDesign(plotDesignId(plot.id) ?? "") ?? null;
    const across: Vec2 = [plot.inward[1], -plot.inward[0]];
    const at = (x: number, z: number): Vec2 => [plot.center[0] + across[0] * x + plot.inward[0] * z, plot.center[1] + across[1] * x + plot.inward[1] * z];
    const toStreet = Math.atan2(-plot.inward[0], -plot.inward[1]);
    const bays: Bay[] = [];
    if (design && design.parking > 0) {
      const sides = design.parking > 2 ? [1, -1] : [1];
      const perSide = Math.ceil(design.parking / sides.length);
      for (let index = 0; index < perSide; index += 1) {
        for (const side of sides) {
          if (bays.length >= Math.min(count, design.parking)) break;
          const [x, z] = at(side * (design.width / 2 + 1.75), -plot.depth / 2 + 0.6 + BAY * (index + 0.5));
          bays.push({ x, z, yaw: toStreet });
        }
      }
    }
    const kerbYaw = Math.atan2(across[0], across[1]);
    bays.push(...kerbBays(plot.kerb, kerbYaw, count - bays.length));
    return { centre: plot.center, radius: Math.max(plot.width, plot.depth) / 2 + 4, bays };
  }
  const place = propertyPlace(propertyId);
  if (!place) return null;
  const [fx, fz] = [Math.sin(place.facing), Math.cos(place.facing)];
  const depth = Math.max(10, place.frontage * 0.6);
  const centre: Vec2 = [place.facade[0] - fx * depth * 0.5, place.facade[1] - fz * depth * 0.5];
  return { centre, radius: Math.max(14, place.frontage * 0.6), bays: kerbBays(place.kerb, place.kerbYaw, count) };
}

/**
 * A camera drone circling a home: it orbits slowly on its own, drags round with the finger, and zooms from a low pass
 * over the roof out to a high shot of the whole street.
 */
export class DroneCamera {
  yaw = 0.6;
  pitch = 0.75;
  /** 0 = closest pass, 1 = highest shot. */
  zoom = 0.45;
  orbiting = true;
  private idleFor = 0;

  constructor(readonly site: DroneSite) {}

  get distance() {
    const near = Math.max(24, this.site.radius * 2);
    return near + (Math.max(near * 4, 160) - near) * this.zoom;
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(0.28, Math.min(1.35, this.pitch + dy * 0.004));
    this.idleFor = 0;
  }

  zoomBy(delta: number) {
    this.zoom = Math.max(0, Math.min(1, this.zoom + delta));
  }

  /** Eye and target for this frame; `ground` is the terrain height under the house. */
  shot(dt: number, ground: number): { eye: [number, number, number]; look: [number, number, number] } {
    this.idleFor += dt;
    // Picks the slow orbit back up a few seconds after the owner lets go.
    if (this.orbiting && this.idleFor > 2.5) this.yaw += dt * 0.12;
    const [cx, cz] = this.site.centre;
    const distance = this.distance;
    const flat = Math.cos(this.pitch) * distance;
    const eye: [number, number, number] = [cx - Math.sin(this.yaw) * flat, ground + 2 + Math.sin(this.pitch) * distance, cz - Math.cos(this.yaw) * flat];
    return { eye, look: [cx, ground + 2, cz] };
  }
}

/** A glowing gold ring on the ground round the home, so it stands out in the high shot. */
export function droneMarker(scene: Scene, site: DroneSite, ground: number): Mesh {
  const ring = MeshBuilder.CreateTorus("drone home ring", { diameter: site.radius * 2, thickness: 1.2, tessellation: 72 }, scene);
  const material = new StandardMaterial("drone home ring", scene);
  material.emissiveColor = Color3.FromHexString("#f2c94c");
  material.disableLighting = true;
  material.alpha = 0.75;
  ring.material = material;
  ring.scaling.y = 0.2;
  ring.position.set(site.centre[0], ground + 0.4, site.centre[1]);
  ring.isPickable = false;
  ring.onDisposeObservable.add(() => material.dispose());
  return ring;
}
