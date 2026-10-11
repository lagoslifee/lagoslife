import { type Vec2 } from "./world.js";

/** Minimal road shape the navigator needs (the streamed world adds more fields). */
export type NavRoad = { name: string | null; points: Vec2[] };

type GraphNode = { id: number; point: Vec2; edges: Array<{ to: number; cost: number; name: string | null }> };

/** Road graph navigation over OSM geometry; junction nodes are merged within 1.5 m. */
export class RoadNavigator {
  private nodes: GraphNode[] = [];

  constructor(roads: NavRoad[]) {
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
        this.nodes[a]!.edges.push({ to: b, cost, name: road.name });
        this.nodes[b]!.edges.push({ to: a, cost, name: road.name });
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

  /** Nearest point on any road to `point`, with the road's heading there. */
  snap(point: Vec2): { point: Vec2; yaw: number; distance: number } {
    let best = { point: this.nodes[0]?.point ?? point, yaw: 0, distance: Infinity };
    for (const node of this.nodes) {
      for (const edge of node.edges) {
        if (edge.to < node.id) continue;
        const [ax, az] = node.point;
        const [bx, bz] = this.nodes[edge.to]!.point;
        const dx = bx - ax;
        const dz = bz - az;
        const length = dx * dx + dz * dz;
        const t = length > 0 ? Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - az) * dz) / length)) : 0;
        const x = ax + dx * t;
        const z = az + dz * t;
        const distance = Math.hypot(point[0] - x, point[1] - z);
        if (distance < best.distance) best = { point: [x, z], yaw: Math.atan2(dx, dz), distance };
      }
    }
    return best;
  }

  route(from: Vec2, to: Vec2): Vec2[] {
    return this.plan(from, to).points;
  }

  /**
   * Road route with the street name of each leg. `reachable` is false when no road joins the start and
   * the destination; `gap` is how far the destination lies from the nearest road (walk the rest).
   */
  plan(from: Vec2, to: Vec2): { points: Vec2[]; names: Array<string | null>; reachable: boolean; gap: number; metres: number } {
    const start = this.nearest(from);
    const goal = this.nearest(to);
    const open = new Set([start.id]);
    const cameFrom = new Map<number, { from: number; name: string | null }>();
    const g = new Map([[start.id, 0]]);
    const f = new Map([[start.id, Math.hypot(start.point[0] - goal.point[0], start.point[1] - goal.point[1])]]);
    let found = start.id === goal.id;
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
      if (current === goal.id) {
        found = true;
        break;
      }
      open.delete(current);
      for (const edge of this.nodes[current]!.edges) {
        const tentative = (g.get(current) ?? Infinity) + edge.cost;
        if (tentative < (g.get(edge.to) ?? Infinity)) {
          cameFrom.set(edge.to, { from: current, name: edge.name });
          g.set(edge.to, tentative);
          const node = this.nodes[edge.to]!;
          f.set(edge.to, tentative + Math.hypot(node.point[0] - goal.point[0], node.point[1] - goal.point[1]));
          open.add(edge.to);
        }
      }
    }
    const gap = Math.hypot(goal.point[0] - to[0], goal.point[1] - to[1]);
    if (!found) return { points: [from, to], names: [null, null], reachable: false, gap, metres: Math.hypot(to[0] - from[0], to[1] - from[1]) };
    const points: Vec2[] = [to];
    const names: Array<string | null> = [null];
    let cursor: number | undefined = goal.id;
    while (cursor !== undefined) {
      const step = cameFrom.get(cursor);
      points.push(this.nodes[cursor]!.point);
      names.push(step?.name ?? null);
      cursor = step?.from;
    }
    points.push(from);
    names.push(null);
    points.reverse();
    names.reverse();
    // names[i] is the street of the leg arriving at points[i]; shift so it names the leg leaving points[i].
    const leaving = names.slice(1).concat(null);
    let metres = 0;
    for (let index = 1; index < points.length; index += 1) metres += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
    return { points, names: leaving, reachable: true, gap, metres };
  }
}
