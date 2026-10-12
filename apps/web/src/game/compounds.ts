import { PLACES, type Place, type Vec2 } from "@lagos-living/shared";

/** The Ikoyi villas for sale are walled compounds: a front wall with a gate, a pool and the owner's cars on the drive. */
export const COMPOUND_PLACES = PLACES.filter((place) => place.district === "ikoyi" && place.kind === "sale");

const CAR_SETS = [
  ["mercedes-g63", "range-rover"],
  ["lexus-rx350", "mercedes-s-class"],
  ["toyota-land-cruiser", "mercedes-g63"],
];

function frame(place: Place) {
  const [dx, dz] = place.door;
  const fx = Math.sin(place.facing);
  const fz = Math.cos(place.facing);
  const span = Math.hypot(place.kerb[0] - dx, place.kerb[1] - dz);
  const at = (along: number, across: number): Vec2 => [dx + fx * along + fz * across, dz + fz * along - fx * across];
  return { span, at };
}

/** Two cars parked nose-in either side of the path from the gate to the front door. */
export function compoundCars(place: Place, index: number) {
  const { span, at } = frame(place);
  const along = Math.min(Math.max(span * 0.42, 4.5), 8);
  return CAR_SETS[index % CAR_SETS.length]!.map((modelId, car) => {
    const side = car === 0 ? -1 : 1;
    const [x, z] = at(along, side * 3.6);
    return { modelId, x, z, yaw: place.facing + Math.PI + side * 0.18 };
  });
}

/** The front wall runs parallel to the street just inside the kerb, leaving a gate gap on the path to the door. */
export function compoundWall(place: Place) {
  const { span, at } = frame(place);
  const along = Math.max(span - 2.6, 6);
  const halfLength = 15;
  const gate = 2.4;
  return {
    along,
    gate,
    segments: [
      [at(along, -halfLength), at(along, -gate)],
      [at(along, gate), at(along, halfLength)],
    ] as Array<[Vec2, Vec2]>,
    gatePosts: [at(along, -gate), at(along, gate)],
  };
}

/** Candidate pool centres in the front garden, clear of the drive; the world builder keeps the first that fits. */
export function compoundPoolSpots(place: Place) {
  const { span, at } = frame(place);
  const spots: Array<{ centre: Vec2; corners: Vec2[] }> = [];
  for (const across of [-10, 10, -12.5, 12.5, -8.2, 8.2]) {
    for (const along of [span * 0.45, span * 0.3, span * 0.6]) {
      if (along < 3.2 || along > span - 4.2) continue;
      const corners = [at(along - 1.9, across - 3.6), at(along - 1.9, across + 3.6), at(along + 1.9, across + 3.6), at(along + 1.9, across - 3.6)];
      spots.push({ centre: at(along, across), corners });
    }
  }
  return spots;
}
