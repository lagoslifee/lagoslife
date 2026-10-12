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

  /** Nearest point on any road segment, with the segment's end nodes and street name. */
  private snapEdge(point: Vec2) {
    let best: { point: Vec2; yaw: number; distance: number; a: number; b: number; name: string | null } | null = null;
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
        if (!best || distance < best.distance) best = { point: [x, z], yaw: Math.atan2(dx, dz), distance, a: node.id, b: edge.to, name: edge.name };
      }
    }
    return best;
  }

  /** Nearest point on any road to `point`, with the road's heading there. */
  snap(point: Vec2): { point: Vec2; yaw: number; distance: number } {
    const best = this.snapEdge(point);
    return best ? { point: best.point, yaw: best.yaw, distance: best.distance } : { point, yaw: 0, distance: Infinity };
  }

  route(from: Vec2, to: Vec2): Vec2[] {
    return this.plan(from, to).points;
  }

  /**
   * Road route with the street name of each leg. `reachable` is false when no road joins the start and
   * the destination; `gap` is how far the destination lies from the nearest road (walk the rest).
   * `approach` (a door's kerb) picks the road the route leaves by: the nearest road to a door is often a back lane or
   * the next street over, so without it the last leg would cut across the block.
   */
  plan(from: Vec2, to: Vec2, approach?: Vec2): { points: Vec2[]; names: Array<string | null>; reachable: boolean; gap: number; metres: number } {
    const start = this.snapEdge(from);
    const goal = this.snapEdge(approach ?? to);
    const straight = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (!start || !goal) return { points: [from, to], names: [null, null], reachable: false, gap: Infinity, metres: straight };
    const gap = goal.distance;
    const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    // Join and leave the graph at the nearest point on a road, not the nearest junction, so the route never starts or
    // ends with a straight line cut across a block.
    const g = new Map<number, number>();
    const cameFrom = new Map<number, { from: number; name: string | null }>();
    const f = new Map<number, number>();
    const open = new Set<number>();
    for (const id of [start.a, start.b]) {
      const cost = distance(start.point, this.nodes[id]!.point);
      if (cost < (g.get(id) ?? Infinity)) {
        g.set(id, cost);
        f.set(id, cost + distance(this.nodes[id]!.point, goal.point));
        open.add(id);
      }
    }
    const sameEdge = (start.a === goal.a && start.b === goal.b) || (start.a === goal.b && start.b === goal.a);
    let best = sameEdge ? distance(start.point, goal.point) : Infinity;
    let bestEnd = -1;
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
      if (lowest >= best) break;
      open.delete(current);
      const reached = g.get(current)!;
      if (current === goal.a || current === goal.b) {
        const total = reached + distance(this.nodes[current]!.point, goal.point);
        if (total < best) {
          best = total;
          bestEnd = current;
        }
      }
      for (const edge of this.nodes[current]!.edges) {
        const tentative = reached + edge.cost;
        if (tentative < (g.get(edge.to) ?? Infinity)) {
          cameFrom.set(edge.to, { from: current, name: edge.name });
          g.set(edge.to, tentative);
          f.set(edge.to, tentative + distance(this.nodes[edge.to]!.point, goal.point));
          open.add(edge.to);
        }
      }
    }
    if (best === Infinity) return { points: [from, to], names: [null, null], reachable: false, gap, metres: straight };
    // names[i] is the street of the leg leaving points[i].
    const points: Vec2[] = [from, start.point];
    const names: Array<string | null> = [null, start.name];
    if (bestEnd >= 0) {
      const chain: number[] = [];
      for (let cursor: number | undefined = bestEnd; cursor !== undefined; cursor = cameFrom.get(cursor)?.from) chain.push(cursor);
      chain.reverse();
      chain.forEach((id, index) => {
        points.push(this.nodes[id]!.point);
        names.push(index < chain.length - 1 ? (cameFrom.get(chain[index + 1]!)?.name ?? null) : goal.name);
      });
    }
    points.push(goal.point);
    names.push(null);
    if (approach) {
      points.push(approach);
      names.push(null);
    }
    points.push(to);
    names.push(null);
    const kept: Vec2[] = [];
    const keptNames: Array<string | null> = [];
    points.forEach((point, index) => {
      const last = kept[kept.length - 1];
      if (last && distance(last, point) < 0.05) {
        kept[kept.length - 1] = point;
        keptNames[keptNames.length - 1] = names[index] ?? keptNames[keptNames.length - 1]!;
        return;
      }
      kept.push(point);
      keptNames.push(names[index]!);
    });
    let metres = 0;
    for (let index = 1; index < kept.length; index += 1) metres += distance(kept[index]!, kept[index - 1]!);
    return { points: kept, names: keptNames, reachable: true, gap, metres };
  }
}
