import { distanceToSegment, type Vec2 } from "@lagos-living/shared";

export type WorldRoad = {
  id: number;
  name: string | null;
  kind: string;
  oneway: boolean;
  width: number;
  bridge?: boolean;
  points: Vec2[];
};

export type WorldBuilding = {
  id: number;
  kind: string;
  levels: number | null;
  name: string | null;
  points: Vec2[];
};

export type WorldArea = { id: number; kind: string; name: string | null; points: Vec2[] };

/** One streamed tile: the buildings and areas whose centroid falls inside it. */
export type WorldTile = { key: string; buildings: WorldBuilding[]; areas: WorldArea[] };

export type WaterGrid = { originX: number; originZ: number; cell: number; cols: number; rows: number; bits: string };

export type WorldData = {
  name: string;
  attribution: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  tileSize: number;
  tiles: Array<{ key: string; buildings: number }>;
  water: WaterGrid;
  roads: WorldRoad[];
  pois: Array<{ id: number; kind: string; name: string | null; position: Vec2 }>;
};

/** Vertex samples of a packed bit grid (1 = water); out-of-range samples are land. */
export function waterSampler(grid: WaterGrid) {
  const binary = atob(grid.bits);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const stride = grid.cols + 1;
  return (col: number, row: number) => {
    if (col < 0 || row < 0 || col > grid.cols || row > grid.rows) return 0;
    const index = row * stride + col;
    return (bytes[index >> 3]! >> (index & 7)) & 1;
  };
}

export type Junction = { point: Vec2; roads: WorldRoad[] };

export function findJunctions(roads: WorldRoad[]) {
  const named = roads.filter((road) => road.name && road.kind !== "footway");
  const junctions: Junction[] = [];
  for (const road of named) {
    for (const point of road.points) {
      const crossing = named.filter(
        (other) =>
          other.name !== road.name &&
          other.points.some((candidate) => Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) < 1.2),
      );
      if (!crossing.length) continue;
      const existing = junctions.find(
        (junction) => Math.hypot(junction.point[0] - point[0], junction.point[1] - point[1]) < 14,
      );
      const members = [road, ...crossing];
      if (existing) {
        for (const member of members) {
          if (!existing.roads.some((known) => known.name === member.name)) existing.roads.push(member);
        }
      } else {
        junctions.push({ point, roads: members.filter((member, index) => members.findIndex((m) => m.name === member.name) === index) });
      }
    }
  }
  return junctions;
}

/** Direction of a road near a point (unit vector along the nearest segment). */
export function roadDirectionNear(road: WorldRoad, point: Vec2): Vec2 {
  let best = { distance: Infinity, dir: [1, 0] as Vec2 };
  for (let index = 1; index < road.points.length; index += 1) {
    const a = road.points[index - 1]!;
    const b = road.points[index]!;
    const distance = distanceToSegment(point[0], point[1], a, b);
    if (distance < best.distance) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      best = { distance, dir: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] };
    }
  }
  return best.dir;
}

export function distanceToRoad(road: WorldRoad, x: number, z: number) {
  let best = Infinity;
  for (let index = 1; index < road.points.length; index += 1) {
    best = Math.min(best, distanceToSegment(x, z, road.points[index - 1]!, road.points[index]!));
  }
  return best;
}

/** Stable "current street" with hysteresis so junctions do not flicker. */
export class StreetTracker {
  private current: WorldRoad | null = null;
  private candidate: WorldRoad | null = null;
  private candidateSince = 0;

  constructor(private readonly roads: WorldRoad[]) {}

  update(x: number, z: number, now: number) {
    let best: { road: WorldRoad; edge: number } | null = null;
    for (const road of this.roads) {
      if (road.kind === "footway") continue;
      const edge = distanceToRoad(road, x, z) - road.width / 2;
      if (edge < 16 && (!best || edge < best.edge)) best = { road, edge };
    }
    const currentEdge = this.current ? distanceToRoad(this.current, x, z) - this.current.width / 2 : Infinity;
    if (!best) {
      if (currentEdge > 22) this.current = null;
      return this.current;
    }
    if (!this.current || currentEdge > 22) {
      this.current = best.road;
      return this.current;
    }
    if (best.road.name === this.current.name) {
      this.candidate = null;
      return this.current;
    }
    if (best.edge + 2.5 < currentEdge) {
      if (this.candidate?.name !== best.road.name) {
        this.candidate = best.road;
        this.candidateSince = now;
      } else if (now - this.candidateSince > 600) {
        this.current = best.road;
        this.candidate = null;
      }
    } else {
      this.candidate = null;
    }
    return this.current;
  }
}

type GraphNode = { id: number; point: Vec2; edges: Array<{ to: number; cost: number }> };

/** Road graph navigation over OSM geometry; junction nodes are merged within 1.5 m. */
export class RoadNavigator {
  private nodes: GraphNode[] = [];

  constructor(roads: WorldRoad[]) {
    const index = new Map<string, number>();
    const nodeFor = (point: Vec2) => {
      const key = `${Math.round(point[0] / 1.5)}:${Math.round(point[1] / 1.5)}`;
      let id = index.get(key);
      if (id === undefined) {
        id = this.nodes.length;
        this.nodes.push({ id, point, edges: [] });
        index.set(key, id);
      }
      return id;
    };
    for (const road of roads) {
      for (let i = 1; i < road.points.length; i += 1) {
        const a = nodeFor(road.points[i - 1]!);
        const b = nodeFor(road.points[i]!);
        if (a === b) continue;
        const cost = Math.hypot(road.points[i]![0] - road.points[i - 1]![0], road.points[i]![1] - road.points[i - 1]![1]);
        this.nodes[a]!.edges.push({ to: b, cost });
        this.nodes[b]!.edges.push({ to: a, cost });
      }
    }
  }

  private nearest(point: Vec2) {
    let best = this.nodes[0]!;
    let bestDistance = Infinity;
    for (const node of this.nodes) {
      const distance = Math.hypot(node.point[0] - point[0], node.point[1] - point[1]);
      if (distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  route(from: Vec2, to: Vec2): Vec2[] {
    const start = this.nearest(from);
    const goal = this.nearest(to);
    const open = new Set([start.id]);
    const cameFrom = new Map<number, number>();
    const g = new Map([[start.id, 0]]);
    const f = new Map([[start.id, Math.hypot(start.point[0] - goal.point[0], start.point[1] - goal.point[1])]]);
    while (open.size) {
      let current = -1;
      let lowest = Infinity;
      for (const id of open) {
        const score = f.get(id) ?? Infinity;
        if (score < lowest) {
          lowest = score;
          current = id;
        }
      }
      if (current === goal.id) break;
      open.delete(current);
      for (const edge of this.nodes[current]!.edges) {
        const tentative = (g.get(current) ?? Infinity) + edge.cost;
        if (tentative < (g.get(edge.to) ?? Infinity)) {
          cameFrom.set(edge.to, current);
          g.set(edge.to, tentative);
          const node = this.nodes[edge.to]!;
          f.set(edge.to, tentative + Math.hypot(node.point[0] - goal.point[0], node.point[1] - goal.point[1]));
          open.add(edge.to);
        }
      }
    }
    const path: Vec2[] = [to];
    let cursor: number | undefined = goal.id;
    while (cursor !== undefined) {
      path.push(this.nodes[cursor]!.point);
      cursor = cameFrom.get(cursor);
    }
    path.push(from);
    return path.reverse();
  }
}
