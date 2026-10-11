import { DISTRICTS, PLACES, ROUTES, STOPS, type PlaceKind, type Vec2 } from "@lagos-living/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GameEngine } from "../game/engine";
import { densify, pointAt, polylineLength } from "../game/geometry";
import { waterSampler, type WorldArea, type WorldBuilding, type WorldData, type WorldRoad } from "../game/street-index";

type View = { cx: number; cz: number; scale: number; width: number; height: number };
type Marker = { point: Vec2; label: string; kind: "objective" | "waypoint" };

const PLACE_GLYPH: Record<PlaceKind, { glyph: string; color: string }> = {
  starter_home: { glyph: "H", color: "#2f7d5b" },
  rental: { glyph: "R", color: "#d9332b" },
  sale: { glyph: "S", color: "#1b4fa0" },
  job: { glyph: "J", color: "#b4621c" },
  food: { glyph: "F", color: "#c0392b" },
  shop: { glyph: "₦", color: "#6b4fa0" },
  furniture: { glyph: "C", color: "#7a5a2f" },
  delivery: { glyph: "D", color: "#8a8a8a" },
  dealership: { glyph: "V", color: "#0f6a8a" },
  mechanic: { glyph: "M", color: "#4a5560" },
  library: { glyph: "L", color: "#5b4a8a" },
  worship: { glyph: "W", color: "#7a6a3a" },
  community: { glyph: "C", color: "#2a7a8a" },
  park: { glyph: "P", color: "#3f8a3a" },
  club: { glyph: "♪", color: "#c2185b" },
};

const waterImages = new WeakMap<WorldData, HTMLCanvasElement>();
/** One pixel per water sample, north up; drawn scaled under the roads. */
function waterImage(data: WorldData) {
  let canvas = waterImages.get(data);
  if (canvas) return canvas;
  const grid = data.water;
  const sample = waterSampler(grid);
  canvas = document.createElement("canvas");
  canvas.width = grid.cols + 1;
  canvas.height = grid.rows + 1;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let row = 0; row <= grid.rows; row += 1) {
    for (let col = 0; col <= grid.cols; col += 1) {
      if (!sample(col, row)) continue;
      const offset = ((grid.rows - row) * canvas.width + col) * 4;
      image.data.set([142, 196, 214, 255], offset);
    }
  }
  ctx.putImageData(image, 0, 0);
  waterImages.set(data, canvas);
  return canvas;
}

const roadBoxes = new WeakMap<WorldRoad, [number, number, number, number]>();
function roadBox(road: WorldRoad) {
  let box = roadBoxes.get(road);
  if (!box) {
    const xs = road.points.map(([x]) => x);
    const zs = road.points.map(([, z]) => z);
    box = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    roadBoxes.set(road, box);
  }
  return box;
}

const ROAD_STYLE: Record<string, { color: string; casing: string; rank: number }> = {
  primary: { color: "#f6d77a", casing: "#c69a3a", rank: 3 },
  primary_link: { color: "#f6e0a0", casing: "#c69a3a", rank: 2 },
  tertiary: { color: "#ffffff", casing: "#b9b2a6", rank: 2 },
  unclassified: { color: "#ffffff", casing: "#c4beb3", rank: 1 },
  residential: { color: "#ffffff", casing: "#cfc9be", rank: 1 },
  service: { color: "#f3f0ea", casing: "#d9d4ca", rank: 0 },
  footway: { color: "#e9d9c4", casing: "#e9d9c4", rank: -1 },
};

function toScreen(view: View, x: number, z: number): Vec2 {
  return [view.width / 2 + (x - view.cx) * view.scale, view.height / 2 - (z - view.cz) * view.scale];
}

/** Picks label anchor points along each named road; denser when zoomed in. */
function labelCandidates(roads: WorldRoad[]) {
  const byName = new Map<string, { road: WorldRoad; length: number; dense: Vec2[] }[]>();
  for (const road of roads) {
    if (!road.name || road.kind === "footway") continue;
    const dense = densify(road.points, 4);
    const list = byName.get(road.name) ?? [];
    list.push({ road, length: polylineLength(dense), dense });
    byName.set(road.name, list);
  }
  return byName;
}

export function drawMap(
  ctx: CanvasRenderingContext2D,
  data: WorldData,
  candidates: ReturnType<typeof labelCandidates>,
  view: View,
  options: {
    pose: { x: number; z: number; yaw: number; cameraYaw: number } | null;
    route: Vec2[];
    markers: Marker[];
    buses: Array<{ x: number; z: number; yaw: number; state: string }>;
    vehicles?: Array<{ x: number; z: number }>;
    /** Buildings and areas of the streamed tiles currently loaded. */
    layer: { buildings: WorldBuilding[]; areas: WorldArea[] };
    showPlaces: boolean;
    compact: boolean;
  },
) {
  const { width, height } = view;
  ctx.save();
  ctx.fillStyle = "#e9e3d6";
  ctx.fillRect(0, 0, width, height);
  const visible = (x: number, z: number, pad: number) => {
    const [sx, sy] = toScreen(view, x, z);
    return sx > -pad && sx < width + pad && sy > -pad && sy < height + pad;
  };

  {
    const grid = data.water;
    const [sx, sy] = toScreen(view, grid.originX - grid.cell / 2, grid.originZ + (grid.rows + 0.5) * grid.cell);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(waterImage(data), sx, sy, (grid.cols + 1) * grid.cell * view.scale, (grid.rows + 1) * grid.cell * view.scale);
  }

  for (const area of options.layer.areas) {
    if (!["pitch", "recreation_ground", "greenfield", "swimming_pool", "park", "garden", "golf_course"].includes(area.kind)) continue;
    ctx.fillStyle = area.kind === "swimming_pool" ? "#9fd3e0" : "#c9dbb0";
    ctx.beginPath();
    area.points.forEach(([x, z], index) => {
      const [sx, sy] = toScreen(view, x, z);
      if (index) ctx.lineTo(sx, sy);
      else ctx.moveTo(sx, sy);
    });
    ctx.fill();
  }

  ctx.fillStyle = "#d3c9b8";
  ctx.strokeStyle = "#bdb19c";
  ctx.lineWidth = 0.6;
  for (const building of options.layer.buildings) {
    const [x0, z0] = building.points[0]!;
    if (!visible(x0, z0, 80 * view.scale + 40)) continue;
    ctx.beginPath();
    building.points.forEach(([x, z], index) => {
      const [sx, sy] = toScreen(view, x, z);
      if (index) ctx.lineTo(sx, sy);
      else ctx.moveTo(sx, sy);
    });
    ctx.closePath();
    ctx.fill();
    if (view.scale > 1.2) ctx.stroke();
  }

  const sorted = [...data.roads].sort((a, b) => (ROAD_STYLE[a.kind]?.rank ?? 0) - (ROAD_STYLE[b.kind]?.rank ?? 0));
  for (const pass of ["casing", "fill"] as const) {
    for (const road of sorted) {
      const [minX, maxX, minZ, maxZ] = roadBox(road);
      const [ax, ay] = toScreen(view, minX, maxZ);
      const [bx, by] = toScreen(view, maxX, minZ);
      if (bx < -20 || ax > width + 20 || by < -20 || ay > height + 20) continue;
      const style = ROAD_STYLE[road.kind] ?? ROAD_STYLE.residential!;
      const px = Math.max(1.2, road.width * view.scale);
      ctx.strokeStyle = pass === "casing" ? style.casing : style.color;
      ctx.lineWidth = pass === "casing" ? px + 2 : px;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (road.kind === "footway") ctx.setLineDash([3, 3]);
      ctx.beginPath();
      road.points.forEach(([x, z], index) => {
        const [sx, sy] = toScreen(view, x, z);
        if (index) ctx.lineTo(sx, sy);
        else ctx.moveTo(sx, sy);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Danfo route line underneath markers.
  ctx.strokeStyle = "rgba(242, 194, 48, 0.55)";
  ctx.lineWidth = Math.max(2, 1.4 * view.scale);
  ctx.setLineDash([6, 4]);
  for (const transit of ROUTES) {
    ctx.beginPath();
    transit.points.forEach(([x, z], index) => {
      const [sx, sy] = toScreen(view, x, z);
      if (index) ctx.lineTo(sx, sy);
      else ctx.moveTo(sx, sy);
    });
    ctx.closePath();
    ctx.stroke();
  }
  ctx.setLineDash([]);

  if (options.route.length > 1) {
    ctx.strokeStyle = "#1ba7d6";
    ctx.lineWidth = Math.max(3, 2.2 * view.scale);
    ctx.beginPath();
    options.route.forEach(([x, z], index) => {
      const [sx, sy] = toScreen(view, x, z);
      if (index) ctx.lineTo(sx, sy);
      else ctx.moveTo(sx, sy);
    });
    ctx.stroke();
  }

  // Street labels: upright, spaced along the road, never overlapping.
  const placed: Array<[number, number, number, number]> = [];
  const overlaps = (box: [number, number, number, number]) =>
    placed.some(([x0, y0, x1, y1]) => box[0] < x1 && box[2] > x0 && box[1] < y1 && box[3] > y0);
  const fontSize = options.compact ? 10 : view.scale > 2 ? 13 : 12;
  ctx.font = `600 ${fontSize}px Inter, Arial, sans-serif`;
  const entries = [...candidates.entries()].sort((a, b) => (ROAD_STYLE[b[1][0]!.road.kind]?.rank ?? 0) - (ROAD_STYLE[a[1][0]!.road.kind]?.rank ?? 0));
  const minRank = view.scale < 0.45 ? 2 : view.scale < 0.9 ? 1 : 0;
  for (const [name, pieces] of entries) {
    const textWidth = ctx.measureText(name).width;
    for (const piece of pieces) {
      if ((ROAD_STYLE[piece.road.kind]?.rank ?? 0) < minRank) continue;
      const screenLength = piece.length * view.scale;
      if (screenLength < textWidth + 16) continue;
      const spacing = Math.max(textWidth + 140, options.compact ? 400 : 320);
      const count = Math.max(1, Math.floor(screenLength / spacing));
      for (let index = 0; index < count; index += 1) {
        const s = ((index + 0.5) / count) * piece.length;
        const a = pointAt(piece.dense, s - textWidth / 2 / view.scale);
        const b = pointAt(piece.dense, s + textWidth / 2 / view.scale);
        const mid = pointAt(piece.dense, s);
        const [ax, ay] = toScreen(view, a.x, a.z);
        const [bx, by] = toScreen(view, b.x, b.z);
        const [mx, my] = toScreen(view, mid.x, mid.z);
        if (mx < 10 || mx > width - 10 || my < 10 || my > height - 10) continue;
        let angle = Math.atan2(by - ay, bx - ax);
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
        const cos = Math.abs(Math.cos(angle));
        const sin = Math.abs(Math.sin(angle));
        const hw = (textWidth * cos + fontSize * sin) / 2 + 3;
        const hh = (textWidth * sin + fontSize * cos) / 2 + 3;
        const box: [number, number, number, number] = [mx - hw, my - hh, mx + hw, my + hh];
        if (overlaps(box)) continue;
        placed.push(box);
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(angle);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.strokeText(name, 0, 0);
        ctx.fillStyle = "#38342d";
        ctx.fillText(name, 0, 0);
        ctx.restore();
      }
    }
  }

  // Bus stops and places.
  for (const stop of STOPS) {
    const [sx, sy] = toScreen(view, stop.pole[0], stop.pole[1]);
    ctx.fillStyle = "#f2c230";
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(sx - 6, sy - 6, 12, 12, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "800 8px Inter, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("B", sx, sy + 0.5);
  }
  if (options.showPlaces) {
    for (const place of PLACES) {
      if (place.kind === "delivery") continue;
      const glyph = PLACE_GLYPH[place.kind]!;
      const [sx, sy] = toScreen(view, place.door[0], place.door[1]);
      ctx.fillStyle = glyph.color;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, options.compact ? 6 : 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = `800 ${options.compact ? 8 : 10}px Inter, Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyph.glyph, sx, sy + 0.5);
      if (!options.compact && view.scale > 0.9) {
        ctx.font = "600 11px Inter, Arial, sans-serif";
        ctx.textAlign = "left";
        const box: [number, number, number, number] = [sx + 10, sy - 7, sx + 14 + ctx.measureText(place.name).width, sy + 7];
        if (!overlaps(box)) {
          placed.push(box);
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(255,255,255,0.9)";
          ctx.strokeText(place.name, sx + 11, sy);
          ctx.fillStyle = "#222";
          ctx.fillText(place.name, sx + 11, sy);
        }
      }
    }
  }

  for (const bus of options.buses) {
    const [sx, sy] = toScreen(view, bus.x, bus.z);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(bus.yaw);
    ctx.fillStyle = "#f2c230";
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.2;
    const w = Math.max(5, 2.1 * view.scale);
    const h = Math.max(9, 4.6 * view.scale);
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  for (const car of options.vehicles ?? []) {
    const [sx, sy] = toScreen(view, car.x, car.z);
    ctx.fillStyle = "#0f6a8a";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("C", sx, sy + 0.5);
  }

  for (const marker of options.markers) {
    const [sx, sy] = toScreen(view, marker.point[0], marker.point[1]);
    const clampedX = Math.max(10, Math.min(width - 10, sx));
    const clampedY = Math.max(10, Math.min(height - 10, sy));
    ctx.fillStyle = marker.kind === "objective" ? "#ffcf3a" : "#1ba7d6";
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(clampedX, clampedY);
    ctx.arc(clampedX, clampedY - 12, 7, Math.PI * 0.8, Math.PI * 2.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  if (options.pose) {
    const [sx, sy] = toScreen(view, options.pose.x, options.pose.z);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.fillStyle = "rgba(27,167,214,0.18)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 38, options.pose.cameraYaw - Math.PI / 2 - 0.5, options.pose.cameraYaw - Math.PI / 2 + 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(options.pose.yaw);
    ctx.fillStyle = "#1ba7d6";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

export function Minimap({ engine, data, markers, onOpen }: { engine: GameEngine; data: WorldData; markers: Marker[]; onOpen: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const candidates = useMemo(() => labelCandidates(data.roads), [data]);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (time - last < 66 || !canvas.current) return;
      last = time;
      const element = canvas.current;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const size = element.clientWidth;
      if (element.width !== size * ratio) {
        element.width = size * ratio;
        element.height = size * ratio;
      }
      const ctx = element.getContext("2d")!;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const pose = engine.pose();
      if (pose.indoors) {
        ctx.fillStyle = "#2b2a27";
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = "#f4efe6";
        ctx.font = "600 12px Inter, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Indoors", size / 2, size / 2);
        return;
      }
      drawMap(ctx, data, candidates, { cx: pose.x, cz: pose.z, scale: 1.25, width: size, height: size }, {
        pose,
        route: engine.routePreview(),
        markers: markersRef.current,
        buses: engine.busPositions(),
        vehicles: engine.myVehicles().filter((car) => car.id !== engine.drivingVehicleId()),
        layer: engine.mapLayer(),
        showPlaces: true,
        compact: true,
      });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [engine, data, candidates]);
  return (
    <button className="minimap" onClick={onOpen} aria-label="Open full map (M)" title="Open full map (M)">
      <canvas ref={canvas} data-testid="minimap" />
      <span className="north">N</span>
    </button>
  );
}

type SearchResult = { label: string; sub: string; point: Vec2 };

export function FullMap({
  engine,
  data,
  markers,
  onNavigate,
  onClose,
}: {
  engine: GameEngine;
  data: WorldData;
  markers: Marker[];
  onNavigate: (target: { point: Vec2; label: string } | null) => void;
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const candidates = useMemo(() => labelCandidates(data.roads), [data]);
  const pose = engine.pose();
  const view = useRef({ cx: pose.x, cz: pose.z, scale: 1.1 });
  const [query, setQuery] = useState("");
  const drag = useRef<{ x: number; y: number } | null>(null);
  const markersRef = useRef(markers);
  markersRef.current = markers;

  const index = useMemo(() => {
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const road of data.roads) {
      if (!road.name || seen.has(road.name)) continue;
      seen.add(road.name);
      const pieces = data.roads.filter((other) => other.name === road.name);
      const longest = pieces.sort((a, b) => polylineLength(b.points) - polylineLength(a.points))[0]!;
      const mid = pointAt(longest.points, polylineLength(longest.points) / 2);
      results.push({ label: road.name, sub: "Street · OpenStreetMap", point: [mid.x, mid.z] });
    }
    for (const place of PLACES) results.push({ label: place.name, sub: `${place.kind.replace("_", " ")} · ${place.street}`, point: place.door });
    for (const stop of STOPS) results.push({ label: stop.name, sub: `Bus stop · ${stop.route.routeNumber} · ₦${stop.route.fare}`, point: stop.alight });
    return results;
  }, [data]);
  const results = query.trim().length >= 2 ? index.filter((result) => result.label.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : [];

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = canvas.current;
      if (!element) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (element.width !== width * ratio || element.height !== height * ratio) {
        element.width = width * ratio;
        element.height = height * ratio;
      }
      const ctx = element.getContext("2d")!;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const live = engine.pose();
      drawMap(ctx, data, candidates, { ...view.current, width, height }, {
        pose: live.indoors ? null : live,
        route: engine.routePreview(),
        markers: markersRef.current,
        buses: engine.busPositions(),
        vehicles: engine.myVehicles().filter((car) => car.id !== engine.drivingVehicleId()),
        layer: engine.mapLayer(),
        showPlaces: true,
        compact: false,
      });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [engine, data, candidates]);

  return (
    <div className="map-modal" role="dialog" aria-label="Map of Lagos">
      <canvas
        ref={canvas}
        data-testid="full-map"
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY };
          (event.target as HTMLElement).setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          view.current.cx -= (event.clientX - drag.current.x) / view.current.scale;
          view.current.cz += (event.clientY - drag.current.y) / view.current.scale;
          drag.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onWheel={(event) => {
          view.current.scale = Math.max(0.12, Math.min(5, view.current.scale * (event.deltaY > 0 ? 0.85 : 1.18)));
        }}
      />
      <div className="map-panel">
        <div className="map-header">
          <div>
            <p className="eyebrow">MAP</p>
            <h2>Lagos</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close map">✕</button>
        </div>
        <input
          className="map-search"
          placeholder="Search streets, places, bus stops…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search the map"
          autoFocus
        />
        <div className="map-districts" role="group" aria-label="Jump to a district">
          {DISTRICTS.filter((district) => district.id !== "link-bridge").map((district) => (
            <button
              key={district.id}
              className="secondary"
              onClick={() => {
                view.current.cx = (district.rect.minX + district.rect.maxX) / 2;
                view.current.cz = (district.rect.minZ + district.rect.maxZ) / 2;
                view.current.scale = 0.35;
              }}
            >
              {district.name}
            </button>
          ))}
        </div>
        <ul className="map-results">
          {results.map((result) => (
            <li key={`${result.label}-${result.point.join()}`}>
              <button
                onClick={() => {
                  view.current.cx = result.point[0];
                  view.current.cz = result.point[1];
                  view.current.scale = Math.max(view.current.scale, 1.6);
                  onNavigate({ point: result.point, label: result.label });
                  setQuery("");
                }}
              >
                <strong>{result.label}</strong>
                <span>{result.sub}</span>
              </button>
            </li>
          ))}
          {query.trim().length >= 2 && !results.length && <li className="muted">No verified street or place by that name.</li>}
        </ul>
        <div className="map-actions">
          <button className="secondary" onClick={() => {
            const live = engine.pose();
            view.current.cx = live.x;
            view.current.cz = live.z;
          }}>Centre on me</button>
          <button className="secondary" onClick={() => onNavigate(null)}>Clear route</button>
        </div>
        <ul className="map-legend">
          <li><i className="lg-b" /> Bus stop ({ROUTES.map((route) => route.routeNumber).join(", ")} · ₦{ROUTES[0]!.fare})</li>
          <li><i className="lg-route" /> Danfo route</li>
          <li><i className="lg-nav" /> Your navigation route</li>
        </ul>
        <p className="attribution">Street names and geometry: {data.attribution}. Unnamed roads stay unnamed.</p>
      </div>
    </div>
  );
}
