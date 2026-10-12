import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { INTERIOR_ORIGIN } from "@lagos-living/shared";

const COLOURS = [new Color3(1, 0.15, 0.6), new Color3(0.2, 0.5, 1), new Color3(0.2, 1, 0.45), new Color3(1, 0.75, 0.1)];

/** Three coloured lights sweeping a home's ceiling while a party is on. */
export class PartyLights {
  private readonly lights: PointLight[];

  constructor(scene: Scene) {
    const [ox, oz] = INTERIOR_ORIGIN;
    this.lights = [0, 1, 2].map((index) => {
      const light = new PointLight(`party light ${index}`, new Vector3(ox, 2.6, oz), scene);
      light.range = 9;
      light.intensity = 0.9;
      return light;
    });
  }

  update(seconds: number) {
    const [ox, oz] = INTERIOR_ORIGIN;
    this.lights.forEach((light, index) => {
      const phase = seconds * (0.9 + index * 0.35) + index * 2.1;
      light.position.set(ox + Math.sin(phase) * 3.2, 2.5, oz + Math.cos(phase * 1.3) * 2.6);
      light.diffuse = COLOURS[(Math.floor(seconds * 2 + index) % COLOURS.length + COLOURS.length) % COLOURS.length]!;
      light.intensity = 0.6 + 0.4 * Math.abs(Math.sin(seconds * 4 + index));
    });
  }

  dispose() {
    for (const light of this.lights) light.dispose();
  }
}
