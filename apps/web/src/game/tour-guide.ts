import { placeById, TRAVEL_PLACES, type CharacterAppearance, type Vec2 } from "@lagos-living/shared";
import type { Avatar, AvatarFactory } from "./avatar";

export type TourStop = { id: string; name: string; point: Vec2; line: string };

/**
 * The free Dubai Marina walking tour: four stops within about 600 m of the tourism centre (a few minutes on foot).
 * Places further out are pointed to rather than walked. Venues are fictional.
 */
const SCRIPT: Array<{ id: string; line: string }> = [
  { id: TRAVEL_PLACES.tourism, line: "Welcome to Dubai Marina! I'm Aisha, your guide. Desert safaris and dhow cruises are booked right here at the tourism centre. Follow me." },
  { id: TRAVEL_PLACES.club, line: "Pearl Club is Dubai nightlife on The Walk: tables, bottles and a DJ every night. Come back after dark." },
  { id: TRAVEL_PLACES.souvenirs, line: "Souvenirs for the people back in Lagos: keyrings, dates, and a little Burj for the shelf." },
  {
    id: TRAVEL_PLACES.carRental,
    line: "Hire a car here to explore. The dhow pier and the boutique are about 800 m east and the Skyline rooftop further on — drive, or take a cab from Phone → Ride. When it's time to go home, Dubai International Airport is the way back to Lagos. Enjoy Dubai!",
  },
];

export function tourStops(): TourStop[] {
  return SCRIPT.flatMap(({ id, line }) => {
    const place = placeById.get(id);
    return place ? [{ id, name: place.name, point: place.door, line }] : [];
  });
}

const GUIDE_LOOK: CharacterAppearance = { body: "female", skinTone: "golden", hairstyle: "long", outfit: "office-skirt", accessory: "none" } as CharacterAppearance;
const WALK = 3.2;
const LEAD = 3;
const WAIT_FOR = 12;

/**
 * A guide NPC who walks the player between stops along the road network, waits when they fall behind, and tells
 * them about each stop on arrival. Purely client-side: other players don't see the guide.
 */
export class TourGuide {
  private readonly avatar: Avatar;
  private index = 0;
  private path: Vec2[] = [];
  private pathIndex = 0;
  private talkUntil = 0;
  private told = -1;
  done = false;

  constructor(
    factory: AvatarFactory,
    private readonly stops: TourStop[],
    start: Vec2,
    private readonly ground: (x: number, z: number) => number,
    private readonly plan: (from: Vec2, to: Vec2) => Vec2[],
    private readonly say: (text: string) => void,
  ) {
    this.avatar = factory.create("tour guide", GUIDE_LOOK);
    this.avatar.root.position.set(start[0] + 1.2, ground(start[0] + 1.2, start[1]), start[1]);
    this.route();
  }

  get stop() {
    return this.stops[this.index] ?? null;
  }

  get progress() {
    return { index: this.index, total: this.stops.length };
  }

  get position(): Vec2 {
    return [this.avatar.root.position.x, this.avatar.root.position.z];
  }

  private route() {
    const stop = this.stop;
    if (!stop) return;
    this.path = [...this.plan(this.position, stop.point), stop.point];
    this.pathIndex = 0;
  }

  update(dt: number, player: Vec2, visible: boolean) {
    this.avatar.root.setEnabled(visible);
    if (!visible || this.done) return;
    const now = performance.now();
    const root = this.avatar.root;
    const stop = this.stop;
    if (!stop) {
      this.avatar.update(0, "wave", dt);
      if (now > this.talkUntil) this.done = true;
      return;
    }
    const atStop = Math.hypot(stop.point[0] - root.position.x, stop.point[1] - root.position.z) < 1.2;
    const playerGap = Math.hypot(player[0] - root.position.x, player[1] - root.position.z);
    if (atStop) {
      root.rotation.y = Math.atan2(player[0] - root.position.x, player[1] - root.position.z);
      if (playerGap < 9 && this.told !== this.index) {
        this.told = this.index;
        this.say(`🧭 ${stop.name}: ${stop.line}`);
        this.talkUntil = now + 7_000;
      }
      const talking = now < this.talkUntil;
      this.avatar.update(0, talking ? "wave" : "idle", dt);
      if (this.told === this.index && !talking) {
        this.index += 1;
        if (!this.stop) this.talkUntil = now + 4_000;
        else this.route();
      }
      return;
    }
    if (playerGap > WAIT_FOR) {
      root.rotation.y = Math.atan2(player[0] - root.position.x, player[1] - root.position.z);
      this.avatar.update(0, "wave", dt);
      return;
    }
    const next = this.path[this.pathIndex] ?? stop.point;
    const dx = next[0] - root.position.x;
    const dz = next[1] - root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.4 && this.pathIndex < this.path.length - 1) {
      this.pathIndex += 1;
      return;
    }
    const speed = playerGap < LEAD ? WALK * 1.15 : WALK;
    const step = Math.min(distance, speed * dt);
    if (distance > 0.001) {
      root.position.x += (dx / distance) * step;
      root.position.z += (dz / distance) * step;
      root.rotation.y = Math.atan2(dx, dz);
    }
    root.position.y = this.ground(root.position.x, root.position.z);
    this.avatar.update(speed, "walk", dt);
  }

  dispose() {
    this.avatar.dispose();
  }
}
