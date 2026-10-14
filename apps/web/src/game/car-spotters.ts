import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { SPRAY_AMOUNTS, vehicleModelById, walkable, type CharacterAppearance, type MotionState, type Vec2 } from "@lagos-living/shared";
import { appearanceFor, type Avatar, type AvatarFactory } from "./avatar";

/** The player's own car as the spotters see it: being driven slowly, or parked with the owner nearby. */
export type SpottedCar = { id: string; x: number; z: number; speed: number; modelId: string; colour: string; condition: number | null };

type Phase = "admire" | "photo" | "ask" | "react" | "scramble" | "leave";
type Spotter = { avatar: Avatar; at: Vec2; phase: Phase; until: number; tag: HTMLDivElement; away: Vec2; target: Note | null; pause: number };
type Note = { mesh: InstancedMesh; x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; sway: number; floor: number; landed: boolean; claimed: boolean; age: number };

const COOLDOWN_MS = 90_000;
const THANKS = ["Boss! God bless you 🙏", "E choke! 💸💸", "Chairman! We hail you 👑", "Odogwu! Thank you sir 🙌", "Omo, na you be the main man 🔥"];
const LEAVE_METRES = 40;
let serial = 0;

/** How special the car is: 0 ordinary, 1 nice, 2 luxury, 3 rare supercar. Non-catalogue paint adds interest; a battered car loses it. */
export function carRarity(car: Pick<SpottedCar, "modelId" | "colour" | "condition">) {
  const model = vehicleModelById.get(car.modelId);
  if (!model || model.category === "bicycle") return 0;
  let score = model.price >= 8_000_000 ? 3 : model.price >= 3_000_000 ? 2 : model.category === "luxury" || model.category === "sports" || (model.category === "motorbike" && model.price >= 1_000_000) ? 1 : 0;
  if (score > 0 && model.colours[0] && car.colour.toLowerCase() !== model.colours[0].toLowerCase()) score += 0.5;
  if (car.condition !== null && car.condition < 50) score -= 1;
  return score;
}

const ADMIRE: Record<number, string[]> = {
  1: ["Nice ride! 👌", "Clean motor 👍"],
  2: ["Ehen! This one sweet o 😍", "Boss, you dey enjoy! 🔥"],
  3: ["Haaa! Is that a {name}?! 🔥🔥", "Omo! {name} for Lekki! 😱", "Chai! Only the real big boys 👑"],
};

/**
 * Pedestrians who stop on the footpath to admire the player's rare car, snap a (simulated) photo and sometimes ask for
 * one with it. They stand on walkable ground away from the road, never follow the car, and leave when it drives off.
 */
export class CarSpotters {
  private spotters: Spotter[] = [];
  private lastByCar = new Map<string, number>();
  private nextCheck = 0;
  private card: HTMLElement | null = null;
  private notes: Note[] = [];
  private noteSource: Mesh | null = null;
  enabled = true;

  constructor(
    private readonly avatars: AvatarFactory,
    private readonly overlay: HTMLElement,
    private readonly ground: (x: number, z: number) => number,
    /** True on walkable ground clear of the carriageway. */
    private readonly footpath: (x: number, z: number) => boolean,
    private readonly project: (x: number, y: number, z: number) => { x: number; y: number; visible: boolean },
    private readonly onAnswer: (text: string) => void,
    /** Pays for a spray on the server; resolves false if it was refused (e.g. not enough money). */
    private readonly onSpray: (amount: number) => Promise<boolean>,
    /** Work clothes for this crowd (the agbero boys wear their union tabards). */
    private readonly dress: ((avatar: Avatar, index: number) => void) | null = null,
  ) {}

  update(dt: number, now: number, car: SpottedCar | null, player: Vec2, outdoors: boolean) {
    if (!this.enabled || !outdoors) {
      if (this.spotters.length) this.clear();
      return;
    }
    if (car && now >= this.nextCheck && !this.spotters.length) {
      this.nextCheck = now + 2_000;
      this.maybeSpawn(now, car, player);
    }
    for (const spotter of [...this.spotters]) this.step(spotter, dt, now, car);
    this.stepNotes(dt);
  }

  private maybeSpawn(now: number, car: SpottedCar, player: Vec2) {
    const rarity = carRarity(car);
    if (rarity < 1 || Math.abs(car.speed) > 4 || Math.hypot(car.x - player[0], car.z - player[1]) > 25) return;
    if (now - (this.lastByCar.get(car.id) ?? -Infinity) < COOLDOWN_MS) return;
    if (Math.random() > 0.25 * rarity) return;
    this.lastByCar.set(car.id, now);
    const name = vehicleModelById.get(car.modelId)?.name ?? "car";
    const count = rarity >= 3 ? 4 : rarity >= 2 ? 3 : 2;
    for (let index = 0; index < count; index++) {
      const lines = car.condition !== null && car.condition < 50 ? ["Fine car — e just need wash small 😅"] : ADMIRE[Math.min(3, Math.floor(rarity))]!;
      if (!this.addSpotter(car, now + 2_500 + index * 600, lines[Math.floor(Math.random() * lines.length)]!.replace("{name}", name), 5, 9)) return;
    }
  }

  private addSpotter(car: SpottedCar, until: number, line: string, near: number, far: number, phase: Phase = "admire") {
    const spot = this.findSpot(car, near, far);
    if (!spot) return null;
    const look: CharacterAppearance = appearanceFor(900 + Math.floor(Math.random() * 400));
    const avatar = this.avatars.create(`car spotter ${serial++}`, this.dress ? { ...look, body: "male" } : look);
    this.dress?.(avatar, serial);
    avatar.root.position.set(spot[0], this.ground(spot[0], spot[1]), spot[1]);
    avatar.root.rotation.y = Math.atan2(car.x - spot[0], car.z - spot[1]);
    const tag = document.createElement("div");
    tag.className = "world-tag spotter-tag";
    tag.textContent = line;
    this.overlay.appendChild(tag);
    const away: Vec2 = [spot[0] - car.x, spot[1] - car.z];
    const length = Math.hypot(away[0], away[1]) || 1;
    const spotter: Spotter = { avatar, at: spot, phase, until, tag, away: [away[0] / length, away[1] / length], target: null, pause: 0 };
    this.spotters.push(spotter);
    return spotter;
  }

  private findSpot(car: SpottedCar, near: number, far: number): Vec2 | null {
    for (let attempt = 0; attempt < 14; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = near + Math.random() * (far - near);
      const x = car.x + Math.cos(angle) * radius;
      const z = car.z + Math.sin(angle) * radius;
      if (this.footpath(x, z) && !this.spotters.some((other) => Math.hypot(other.at[0] - x, other.at[1] - z) < 1.5)) return [x, z];
    }
    return null;
  }

  private step(spotter: Spotter, dt: number, now: number, car: SpottedCar | null) {
    const gone = !car || Math.hypot(car.x - spotter.at[0], car.z - spotter.at[1]) > LEAVE_METRES || Math.abs(car.speed) > 8;
    if (gone && spotter.phase !== "leave" && spotter.phase !== "scramble") this.leave(spotter, now, null);
    if (spotter.phase === "scramble") return this.scramble(spotter, dt, now);
    let motion: MotionState = "idle";
    if (spotter.phase === "admire" && now > spotter.until) {
      spotter.phase = "photo";
      spotter.until = now + 2_200;
      spotter.tag.textContent = "📸 *snap* (in-game photo)";
      spotter.tag.classList.add("flash");
    } else if (spotter.phase === "photo" && now > spotter.until) {
      spotter.tag.classList.remove("flash");
      const first = this.spotters[0] === spotter;
      const stopped = car && Math.abs(car.speed) < 3;
      if (first && stopped && car && carRarity(car) >= 1 && !this.card) {
        spotter.phase = "ask";
        spotter.until = now + 14_000;
        spotter.tag.textContent = "Abeg, one picture with your car? 🙏";
        this.ask(spotter, car);
      } else {
        this.leave(spotter, now, "Correct! 👏");
      }
    } else if (spotter.phase === "ask" && now > spotter.until) {
      this.closeCard();
      this.leave(spotter, now, "No wahala 👋");
    } else if (spotter.phase === "react") {
      motion = "wave";
      if (now > spotter.until) this.leave(spotter, now, null);
    } else if (spotter.phase === "leave") {
      motion = "walk";
      if (now > spotter.until) return this.remove(spotter);
      const next: Vec2 = [spotter.at[0] + spotter.away[0] * dt * 1.3, spotter.at[1] + spotter.away[1] * dt * 1.3];
      if (walkable(next[0], next[1])) spotter.at = next;
      else motion = "idle";
      spotter.avatar.root.position.set(spotter.at[0], this.ground(spotter.at[0], spotter.at[1]), spotter.at[1]);
      spotter.avatar.root.rotation.y = Math.atan2(spotter.away[0], spotter.away[1]);
    } else if (car) {
      spotter.avatar.root.rotation.y = Math.atan2(car.x - spotter.at[0], car.z - spotter.at[1]);
      if (spotter.phase === "admire" && Math.random() < 0.02) motion = "wave";
    }
    spotter.avatar.update(motion === "walk" ? 1.3 : 0, motion, dt);
    const screen = this.project(spotter.at[0], this.ground(spotter.at[0], spotter.at[1]) + 2.1, spotter.at[1]);
    spotter.tag.style.display = screen.visible && spotter.tag.textContent ? "block" : "none";
    if (screen.visible) spotter.tag.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -100%)`;
  }

  /** A small card the driver can answer or ignore; it never blocks steering. */
  private ask(spotter: Spotter, car: SpottedCar) {
    const name = vehicleModelById.get(car.modelId)?.name ?? "car";
    const card = document.createElement("section");
    card.className = "spotter-card";
    card.setAttribute("data-testid", "spotter-card");
    const sprays = SPRAY_AMOUNTS.map((amount) => `<button class="spray" data-choice="spray" data-amount="${amount}">💸 Spray ₦${amount >= 1000 ? `${amount / 1000}k` : amount}</button>`).join("");
    card.innerHTML = `<p></p><div class="row">${sprays}</div><div class="row"><button data-choice="pose">Pose for it</button><button data-choice="wave">Just wave</button><button data-choice="decline">No thanks</button></div>`;
    card.querySelector("p")!.textContent = `Car spotters are hyping your ${name}. Spray them some (game) money from the roof, or pose for a photo?`;
    card.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest("button");
      const choice = button?.dataset.choice;
      if (!choice) return;
      this.closeCard();
      const now = performance.now();
      if (choice === "spray") {
        const amount = Number(button!.dataset.amount);
        spotter.tag.textContent = "Ehen! Spray am! 🙌";
        void this.onSpray(amount).then((paid) => {
          if (!paid) {
            spotter.tag.textContent = "No wahala, next time 👍";
            spotter.phase = "react";
            spotter.until = performance.now() + 2_500;
            return;
          }
          this.shower(car, amount);
        });
        return;
      }
      if (choice === "pose") {
        spotter.tag.textContent = "📸 Thank you o! This one go viral 🙌";
        this.onAnswer(`You posed with your ${name}. The photo stays in their (pretend) gallery — no real camera is used.`);
      } else if (choice === "wave") {
        spotter.tag.textContent = "👋 Enjoy am, boss!";
      } else {
        spotter.tag.textContent = "No wahala, safe drive 👍";
      }
      spotter.phase = "react";
      spotter.until = now + 2_500;
    });
    this.overlay.appendChild(card);
    this.card = card;
  }

  private noteMesh() {
    if (this.noteSource) return this.noteSource;
    const scene = this.avatars.scene;
    const texture = new DynamicTexture("naira note", { width: 128, height: 64 }, scene, true);
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    const paper = ctx.createLinearGradient(0, 0, 128, 0);
    paper.addColorStop(0, "#9b6cc0");
    paper.addColorStop(0.5, "#6fb37a");
    paper.addColorStop(1, "#9b6cc0");
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = "#e9e2c4";
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 120, 56);
    ctx.fillStyle = "#f4ecd0";
    ctx.font = "bold 26px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("₦1000", 64, 42);
    texture.update(true);
    const material = new StandardMaterial("naira note", scene);
    material.diffuseTexture = texture;
    material.emissiveColor = new Color3(0.6, 0.6, 0.6);
    material.specularColor = Color3.Black();
    material.backFaceCulling = false;
    const source = MeshBuilder.CreatePlane("naira note", { width: 0.17, height: 0.085, sideOrientation: Mesh.DOUBLESIDE }, scene);
    source.material = material;
    source.isPickable = false;
    source.setEnabled(false);
    this.noteSource = source;
    return source;
  }

  /** Notes thrown up off the car roof flutter down round it, and the spotters (plus a few who come running) scramble for them. */
  private shower(car: SpottedCar, amount: number) {
    const model = vehicleModelById.get(car.modelId);
    this.rain(car.x, car.z, this.ground(car.x, car.z) + (model?.height ?? 1.5) + 0.25, amount, 3, "Money dey fall! 🏃");
    this.onAnswer(`You sprayed ₦${amount.toLocaleString("en-NG")} from the roof. The spotters go wild! (Game money, paid to NPCs.)`);
  }

  /** Notes thrown up from `top` at (x, z) flutter down, and `crowd` people come running from up the road to scramble for them. */
  rain(x: number, z: number, top: number, amount: number, crowd: number, line: string) {
    const car: SpottedCar = { id: "rain", x, z, speed: 0, modelId: "", colour: "", condition: null };
    const now = performance.now();
    const roof = top;
    const source = this.noteMesh();
    const count = Math.min(40, Math.max(10, Math.round(amount / 500)));
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const push = 1.2 + Math.random() * 2.6;
      const mesh = source.createInstance(`note ${serial++}`);
      mesh.isPickable = false;
      const note: Note = {
        mesh,
        x: car.x + (Math.random() - 0.5) * 0.4,
        y: roof + index * 0.015,
        z: car.z + (Math.random() - 0.5) * 0.4,
        vx: Math.cos(angle) * push,
        vy: 1.8 + Math.random() * 2.4,
        vz: Math.sin(angle) * push,
        spin: (Math.random() - 0.5) * 14,
        sway: Math.random() * Math.PI * 2,
        floor: 0,
        landed: false,
        claimed: false,
        age: 0,
      };
      note.floor = this.ground(note.x + note.vx * 1.4, note.z + note.vz * 1.4) + 0.012;
      this.notes.push(note);
    }
    for (let index = 0; index < crowd; index++) this.addSpotter(car, now + 12_000, line, 12, 20, "scramble");
    for (const spotter of this.spotters) {
      if (spotter.phase === "leave") continue;
      spotter.phase = "scramble";
      spotter.until = now + 12_000;
      spotter.tag.textContent = "💸💸 Ehen!!";
    }
  }

  private stepNotes(dt: number) {
    // Notes nobody picks up (the celebrants' family gathers them off-screen) fade out rather than piling up.
    for (const note of this.notes) note.age += dt;
    const stale = this.notes.filter((note) => note.landed && !note.claimed && note.age > 25);
    if (stale.length) {
      for (const note of stale) note.mesh.dispose();
      this.notes = this.notes.filter((note) => !stale.includes(note));
    }
    for (const note of this.notes) {
      if (note.landed) continue;
      note.sway += dt * 5;
      note.vy = Math.max(note.vy - 9.8 * dt, -1.5);
      const drag = note.vy < 0 ? 1 - Math.min(1, dt * 1.6) : 1;
      note.vx *= drag;
      note.vz *= drag;
      note.x += (note.vx + (note.vy < 0 ? Math.sin(note.sway) * 0.6 : 0)) * dt;
      note.z += (note.vz + (note.vy < 0 ? Math.cos(note.sway * 0.8) * 0.6 : 0)) * dt;
      note.y += note.vy * dt;
      if (note.y <= note.floor && note.vy < 0) {
        note.y = note.floor;
        note.landed = true;
        note.mesh.rotation.set(Math.PI / 2, Math.random() * Math.PI, 0);
      } else {
        note.mesh.rotation.set(note.sway * 0.7, note.sway * 0.4 + note.spin * 0.05, Math.sin(note.sway) * 0.8 + note.spin * dt);
      }
      note.mesh.position.set(note.x, note.y, note.z);
    }
  }

  private scramble(spotter: Spotter, dt: number, now: number) {
    let motion: MotionState = "jog";
    if (!spotter.target || !this.notes.includes(spotter.target)) {
      spotter.target = null;
      let best = Infinity;
      for (const note of this.notes) {
        if (note.claimed) continue;
        const distance = Math.hypot(note.x - spotter.at[0], note.z - spotter.at[1]);
        if (distance < best) [best, spotter.target] = [distance, note];
      }
      if (spotter.target) spotter.target.claimed = true;
    }
    const note = spotter.target;
    if (!note || now > spotter.until) {
      if (note) note.claimed = false;
      spotter.target = null;
      return this.leave(spotter, now, THANKS[Math.floor(Math.random() * THANKS.length)]!);
    }
    if (spotter.pause > 0) {
      spotter.pause -= dt;
      motion = "idle";
      if (spotter.pause <= 0) {
        note.mesh.dispose();
        this.notes = this.notes.filter((entry) => entry !== note);
        spotter.target = null;
        if (Math.random() < 0.3) spotter.tag.textContent = THANKS[Math.floor(Math.random() * THANKS.length)]!;
      }
    } else {
      const dx = note.x - spotter.at[0];
      const dz = note.z - spotter.at[1];
      const distance = Math.hypot(dx, dz);
      if (distance < 0.45) {
        motion = "idle";
        if (note.landed || note.y < this.ground(note.x, note.z) + 1.3) spotter.pause = 0.35;
      } else {
        const step = Math.min(distance, 4.2 * dt);
        spotter.at = [spotter.at[0] + (dx / distance) * step, spotter.at[1] + (dz / distance) * step];
        spotter.avatar.root.rotation.y = Math.atan2(dx, dz);
      }
    }
    spotter.avatar.root.position.set(spotter.at[0], this.ground(spotter.at[0], spotter.at[1]), spotter.at[1]);
    spotter.avatar.update(motion === "jog" ? 4.2 : 0, motion, dt);
    const screen = this.project(spotter.at[0], this.ground(spotter.at[0], spotter.at[1]) + 2.1, spotter.at[1]);
    spotter.tag.style.display = screen.visible && spotter.tag.textContent ? "block" : "none";
    if (screen.visible) spotter.tag.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -100%)`;
  }

  private closeCard() {
    this.card?.remove();
    this.card = null;
  }

  private leave(spotter: Spotter, now: number, line: string | null) {
    if (line) spotter.tag.textContent = line;
    if (spotter.target) spotter.target.claimed = false;
    spotter.target = null;
    if (spotter.phase === "ask") this.closeCard();
    spotter.phase = "leave";
    spotter.until = now + 4_000;
  }

  private remove(spotter: Spotter) {
    spotter.avatar.dispose();
    spotter.tag.remove();
    this.spotters = this.spotters.filter((entry) => entry !== spotter);
    if (!this.spotters.some((entry) => entry.phase === "ask")) this.closeCard();
    if (!this.spotters.length) {
      for (const note of this.notes) note.mesh.dispose();
      this.notes = [];
    }
  }

  clear() {
    for (const spotter of [...this.spotters]) this.remove(spotter);
    for (const note of this.notes) note.mesh.dispose();
    this.notes = [];
    this.closeCard();
  }
}
