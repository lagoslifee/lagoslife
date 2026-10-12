import { vehicleModelById, walkable, type CharacterAppearance, type MotionState, type Vec2 } from "@lagos-living/shared";
import { appearanceFor, type Avatar, type AvatarFactory } from "./avatar";

/** The player's own car as the spotters see it: being driven slowly, or parked with the owner nearby. */
export type SpottedCar = { id: string; x: number; z: number; speed: number; modelId: string; colour: string; condition: number | null };

type Phase = "admire" | "photo" | "ask" | "react" | "leave";
type Spotter = { avatar: Avatar; at: Vec2; phase: Phase; until: number; tag: HTMLDivElement; away: Vec2 };

const COOLDOWN_MS = 150_000;
const LEAVE_METRES = 40;
let serial = 0;

/** How special the car is: 0 ordinary, 1 nice, 2 luxury, 3 rare supercar. Non-catalogue paint adds interest; a battered car loses it. */
export function carRarity(car: Pick<SpottedCar, "modelId" | "colour" | "condition">) {
  const model = vehicleModelById.get(car.modelId);
  if (!model || model.category === "bicycle") return 0;
  let score = model.price >= 8_000_000 ? 3 : model.price >= 3_000_000 ? 2 : model.category === "luxury" || model.category === "sports" ? 1 : 0;
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
  enabled = true;

  constructor(
    private readonly avatars: AvatarFactory,
    private readonly overlay: HTMLElement,
    private readonly ground: (x: number, z: number) => number,
    /** True on walkable ground clear of the carriageway. */
    private readonly footpath: (x: number, z: number) => boolean,
    private readonly project: (x: number, y: number, z: number) => { x: number; y: number; visible: boolean },
    private readonly onAnswer: (text: string) => void,
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
  }

  private maybeSpawn(now: number, car: SpottedCar, player: Vec2) {
    const rarity = carRarity(car);
    if (rarity < 1 || Math.abs(car.speed) > 4 || Math.hypot(car.x - player[0], car.z - player[1]) > 25) return;
    if (now - (this.lastByCar.get(car.id) ?? -Infinity) < COOLDOWN_MS) return;
    if (Math.random() > 0.12 * rarity) return;
    this.lastByCar.set(car.id, now);
    const name = vehicleModelById.get(car.modelId)?.name ?? "car";
    const count = rarity >= 3 ? 2 : 1;
    for (let index = 0; index < count; index++) {
      const spot = this.findSpot(car);
      if (!spot) return;
      const look: CharacterAppearance = appearanceFor(900 + Math.floor(Math.random() * 400));
      const avatar = this.avatars.create(`car spotter ${serial++}`, look);
      avatar.root.position.set(spot[0], this.ground(spot[0], spot[1]), spot[1]);
      avatar.root.rotation.y = Math.atan2(car.x - spot[0], car.z - spot[1]);
      const tag = document.createElement("div");
      tag.className = "world-tag spotter-tag";
      const lines = car.condition !== null && car.condition < 50 ? ["Fine car — e just need wash small 😅"] : ADMIRE[Math.min(3, Math.floor(rarity))]!;
      tag.textContent = lines[Math.floor(Math.random() * lines.length)]!.replace("{name}", name);
      this.overlay.appendChild(tag);
      const away: Vec2 = [spot[0] - car.x, spot[1] - car.z];
      const length = Math.hypot(away[0], away[1]) || 1;
      this.spotters.push({ avatar, at: spot, phase: "admire", until: now + 2_500 + index * 600, tag, away: [away[0] / length, away[1] / length] });
    }
  }

  private findSpot(car: SpottedCar): Vec2 | null {
    for (let attempt = 0; attempt < 14; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 5 + Math.random() * 4;
      const x = car.x + Math.cos(angle) * radius;
      const z = car.z + Math.sin(angle) * radius;
      if (this.footpath(x, z) && !this.spotters.some((other) => Math.hypot(other.at[0] - x, other.at[1] - z) < 1.5)) return [x, z];
    }
    return null;
  }

  private step(spotter: Spotter, dt: number, now: number, car: SpottedCar | null) {
    const gone = !car || Math.hypot(car.x - spotter.at[0], car.z - spotter.at[1]) > LEAVE_METRES || Math.abs(car.speed) > 8;
    if (gone && spotter.phase !== "leave") this.leave(spotter, now, null);
    let motion: MotionState = "idle";
    if (spotter.phase === "admire" && now > spotter.until) {
      spotter.phase = "photo";
      spotter.until = now + 2_200;
      spotter.tag.textContent = "📸 *snap* (in-game photo)";
      spotter.tag.classList.add("flash");
    } else if (spotter.phase === "photo" && now > spotter.until) {
      spotter.tag.classList.remove("flash");
      const first = this.spotters[0] === spotter;
      const stopped = car && Math.abs(car.speed) < 0.6;
      if (first && stopped && car && carRarity(car) >= 2 && !this.card) {
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
    card.innerHTML = `<p></p><div class="row"><button data-choice="pose">Pose for it</button><button data-choice="wave">Just wave</button><button data-choice="decline">No thanks</button></div>`;
    card.querySelector("p")!.textContent = `A car spotter asks for a photo with your ${name}.`;
    card.addEventListener("click", (event) => {
      const choice = (event.target as HTMLElement).dataset.choice;
      if (!choice) return;
      this.closeCard();
      const now = performance.now();
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

  private closeCard() {
    this.card?.remove();
    this.card = null;
  }

  private leave(spotter: Spotter, now: number, line: string | null) {
    if (line) spotter.tag.textContent = line;
    if (spotter.phase === "ask") this.closeCard();
    spotter.phase = "leave";
    spotter.until = now + 4_000;
  }

  private remove(spotter: Spotter) {
    spotter.avatar.dispose();
    spotter.tag.remove();
    this.spotters = this.spotters.filter((entry) => entry !== spotter);
    if (!this.spotters.some((entry) => entry.phase === "ask")) this.closeCard();
  }

  clear() {
    for (const spotter of [...this.spotters]) this.remove(spotter);
    this.closeCard();
  }
}
