import {
  findFreeSpot,
  FURNITURE,
  furnitureItem,
  FRONT_WALL,
  furnitureRect,
  HOME_LAYOUTS,
  homeLayout,
  misplacedRoom,
  placementProblem,
  ROOM_NAMES,
  snapFloor,
  type FurnitureRotation,
  type Notice,
  type PlacedPiece,
  type RoomKind,
} from "@lagos-living/shared";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { api, naira, type EconomyState, type InteriorState } from "../api";
import type { GameEngine } from "../game/engine";
import { HomeParking } from "./HomeParking";

type Props = {
  engine: GameEngine;
  propertyId: string;
  homeName: string;
  /** Street door, for finding the cars parked outside. */
  door: [number, number] | null;
  economy: EconomyState | null;
  /** Placement to pick up as soon as the plan opens. */
  focus?: string | null;
  onDrone?: () => void;
  onClose: () => void;
  onToast: (notice: Notice) => void;
  onRefresh: () => Promise<void>;
};

type Tab = "arrange" | "parking" | "shop" | "guests";
type Drag = { id: string; dx: number; dz: number; x: number; z: number; moved: boolean };

/** Share of the screen, from the top, left for the 3D view looking down into the room. */
const VIEW_SHARE = 0.4;
const PAD = 0.25;

/**
 * Home designer: a floor plan to drag, turn and pick up furniture, with the room itself seen from straight above
 * in the top of the screen. Also your cars in the garage and driveway, the furniture catalogue (delivered, so it can be bought from here) and the guest list.
 */
export function HomeDesigner({ engine, propertyId, homeName, door, economy, focus = null, onDrone, onClose, onToast, onRefresh }: Props) {
  const [interior, setInterior] = useState<InteriorState | null>(null);
  const [tab, setTab] = useState<Tab>("arrange");
  const [selected, setSelected] = useState<string | null>(focus);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState(false);
  const [friend, setFriend] = useState("");
  const svg = useRef<SVGSVGElement>(null);

  const reload = useCallback(async () => {
    try {
      setInterior(await api.interior(propertyId));
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    }
  }, [propertyId, onToast]);

  useEffect(() => {
    engine.setPlanView(VIEW_SHARE);
    void reload();
    return () => engine.setPlanView(null);
  }, [engine, reload]);

  const run = async (success: string | null, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      if (success) onToast({ tone: "success", text: success });
      await Promise.all([reload(), onRefresh()]);
      void engine.refreshInterior();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const pieces: Array<PlacedPiece & { id: string; name: string }> = (interior?.furniture ?? []).map((piece) =>
    drag && drag.id === piece.id ? { ...piece, x: drag.x, z: drag.z } : piece,
  );
  const selectedPiece = pieces.find((piece) => piece.id === selected) ?? null;
  const layout = interior?.tier ? HOME_LAYOUTS[interior.tier] : homeLayout(propertyId);
  const problem = (piece: PlacedPiece) => placementProblem(piece, pieces, layout);

  const floorPoint = (event: ReactPointerEvent) => {
    const matrix = svg.current?.getScreenCTM();
    if (!svg.current || !matrix) return null;
    const point = svg.current.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, z: -local.y };
  };

  const startDrag = (event: ReactPointerEvent, piece: PlacedPiece & { id: string }) => {
    if (busy) return;
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    const at = floorPoint(event);
    if (!at) return;
    setSelected(piece.id);
    setDrag({ id: piece.id, dx: piece.x - at.x, dz: piece.z - at.z, x: piece.x, z: piece.z, moved: false });
  };

  const moveDrag = (event: ReactPointerEvent) => {
    if (!drag) return;
    const at = floorPoint(event);
    if (!at) return;
    const x = snapFloor(Math.max(-layout.halfX, Math.min(layout.halfX, at.x + drag.dx)));
    const z = snapFloor(Math.max(FRONT_WALL, Math.min(layout.back, at.z + drag.dz)));
    if (x !== drag.x || z !== drag.z) setDrag({ ...drag, x, z, moved: true });
  };

  const endDrag = () => {
    if (!drag) return;
    const piece = interior?.furniture.find((entry) => entry.id === drag.id);
    setDrag(null);
    if (!piece || !drag.moved) return;
    const reason = placementProblem({ ...piece, x: drag.x, z: drag.z }, interior!.furniture, layout);
    if (reason) return onToast({ tone: "error", text: reason });
    setInterior({ ...interior!, furniture: interior!.furniture.map((entry) => (entry.id === piece.id ? { ...entry, x: drag.x, z: drag.z } : entry)) });
    void run(null, () => api.moveFurniture(propertyId, piece.id, drag.x, drag.z, piece.rotation as FurnitureRotation));
  };

  const turn = () => {
    if (!selectedPiece) return;
    const rotation = ((selectedPiece.rotation + 90) % 360) as FurnitureRotation;
    const reason = problem({ ...selectedPiece, rotation });
    if (reason) return onToast({ tone: "error", text: `Not enough room to turn it: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` });
    void run(null, () => api.moveFurniture(propertyId, selectedPiece.id, selectedPiece.x, selectedPiece.z, rotation));
  };

  /** "in the bedroom" for wherever a spot landed, or nothing in an open part of the floor. */
  const whereIs = (x: number, z: number) => {
    const room = layout.rooms.find((zone) => Math.abs(x - zone.x) <= zone.hx && Math.abs(z - zone.z) <= zone.hz)?.room;
    return room ? ` in the ${ROOM_NAMES[room].toLowerCase()}` : "";
  };

  const placeNew = (itemId: string, name: string) => {
    const spot = findFreeSpot(itemId, pieces, layout);
    if (!spot) return onToast({ tone: "error", text: `No free floor left for the ${name.toLowerCase()}. Pick something up first.` });
    void run(`${name} placed${whereIs(spot.x, spot.z)}. Drag it anywhere you like.`, () => api.placeFurnitureAt(propertyId, itemId, spot.x, spot.z, spot.rotation));
  };

  const moveTo = (piece: PlacedPiece & { id: string; name: string }, room: RoomKind) => {
    const spot = findFreeSpot(piece.itemId, pieces.filter((entry) => entry.id !== piece.id), layout, room);
    if (!spot) return onToast({ tone: "error", text: `No free floor in the ${ROOM_NAMES[room].toLowerCase()} for the ${piece.name.toLowerCase()}.` });
    void run(`${piece.name} moved${whereIs(spot.x, spot.z) || ` near the ${ROOM_NAMES[room].toLowerCase()}`}.`, () => api.moveFurniture(propertyId, piece.id, spot.x, spot.z, spot.rotation));
  };

  const nudge = (dx: number, dz: number) => {
    if (!selectedPiece) return;
    const moved = { ...selectedPiece, x: snapFloor(selectedPiece.x + dx), z: snapFloor(selectedPiece.z + dz) };
    const reason = problem(moved);
    if (reason) return onToast({ tone: "error", text: reason });
    setInterior({ ...interior!, furniture: interior!.furniture.map((entry) => (entry.id === moved.id ? { ...entry, x: moved.x, z: moved.z } : entry)) });
    void run(null, () => api.moveFurniture(propertyId, moved.id, moved.x, moved.z, moved.rotation as FurnitureRotation));
  };

  const misplaced = pieces.flatMap((piece) => {
    const room = misplacedRoom(piece, layout);
    return room ? [{ piece, room }] : [];
  });

  /** Moves every piece standing in the wrong room to the room it belongs in. */
  const tidyUp = () =>
    void run(`Done — ${misplaced.length === 1 ? "it is" : "everything is"} where it belongs.`, async () => {
      let floor = [...pieces];
      for (const { piece, room } of misplaced) {
        const spot = findFreeSpot(piece.itemId, floor.filter((entry) => entry.id !== piece.id), layout, room);
        if (!spot) continue;
        await api.moveFurniture(propertyId, piece.id, spot.x, spot.z, spot.rotation);
        floor = floor.map((entry) => (entry.id === piece.id ? { ...entry, ...spot } : entry));
      }
    });

  const buyAndPlace = (itemId: string) => {
    const item = furnitureItem(itemId)!;
    const spot = findFreeSpot(itemId, pieces, layout);
    if (!spot) return onToast({ tone: "error", text: `No free floor left for the ${item.name.toLowerCase()}. Pick something up first.` });
    void run(`${item.name} delivered${whereIs(spot.x, spot.z)} for ${naira(item.price)}.`, async () => {
      await api.purchase(itemId);
      await api.placeFurnitureAt(propertyId, itemId, spot.x, spot.z, spot.rotation);
      setTab("arrange");
    });
  };

  const balance = economy?.balance ?? 0;
  const hx = layout.halfX;
  const [south, north] = [FRONT_WALL, layout.back];
  const owner = interior?.access.owner ?? false;

  return (
    <section className="designer" role="dialog" aria-label={`Design ${homeName}`} data-testid="home-designer">
      <header>
        <div>
          <p className="eyebrow">DESIGN YOUR HOME</p>
          <h2>{homeName}</h2>
        </div>
        <div className="row">
          {onDrone && <button className="secondary" onClick={onDrone} data-testid="designer-drone">🚁 Drone view</button>}
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </header>
      <nav className="designer-tabs">
        {(["arrange", "parking", "shop", "guests"] as const).map((entry) => (
          <button key={entry} className={tab === entry ? "active" : ""} onClick={() => setTab(entry)}>
            {entry === "arrange" ? "🛋 Arrange" : entry === "parking" ? "🚗 Cars & garage" : entry === "shop" ? "🛒 Furniture shop" : "👥 Invite friends"}
          </button>
        ))}
      </nav>

      {tab === "arrange" && (
        <div className="designer-body">
          <svg
            ref={svg}
            className="floor-plan"
            viewBox={`${-hx - PAD} ${-north - PAD} ${(hx + PAD) * 2} ${north - south + PAD * 2}`}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerDown={() => setSelected(null)}
            data-testid="floor-plan"
          >
            <rect x={-hx} y={-north} width={hx * 2} height={north - south} className="plan-floor" />
            {[-3, 0, 3].map((x) => <rect key={x} x={x - 0.7} y={-north - 0.08} width={1.4} height={0.16} className="plan-window" />)}
            {layout.rooms.map((room) => (
              <g key={room.room} className={`plan-room ${room.room}`}>
                <rect x={room.x - room.hx} y={-room.z - room.hz} width={room.hx * 2} height={room.hz * 2} />
                <text x={room.x - room.hx + 0.15} y={-room.z - room.hz + 0.35}>{ROOM_NAMES[room.room]}</text>
              </g>
            ))}
            {layout.fixtures.map((fixture) => (
              <g key={`${fixture.label} ${fixture.x} ${fixture.z}`}>
                <rect x={fixture.x - fixture.hx} y={-fixture.z - fixture.hz} width={fixture.hx * 2} height={fixture.hz * 2} className="plan-fixture" />
                <text x={fixture.x} y={-fixture.z} className="plan-fixture-label">{fixture.label}</text>
              </g>
            ))}
            <rect x={-0.55} y={-south - 0.06} width={1.1} height={0.2} className="plan-door" />
            {[...pieces].sort((a, b) => Number(Boolean(furnitureItem(b.itemId)?.floor)) - Number(Boolean(furnitureItem(a.itemId)?.floor))).map((piece) => {
              const item = furnitureItem(piece.itemId);
              if (!item) return null;
              const rect = furnitureRect(item, piece.x, piece.z, piece.rotation);
              const yaw = (piece.rotation * Math.PI) / 180;
              const invalid = drag?.id === piece.id && Boolean(problem(piece));
              const backX = Math.sin(yaw) * rect.hx;
              const backY = -Math.cos(yaw) * rect.hz;
              return (
                <g
                  key={piece.id}
                  className={`plan-piece ${selected === piece.id ? "selected" : ""} ${invalid ? "invalid" : ""} ${item.floor ? "rug" : ""}`}
                  onPointerDown={(event) => owner && startDrag(event, piece)}
                  data-testid={`piece-${piece.itemId}`}
                >
                  <rect x={rect.x - rect.hx} y={-rect.z - rect.hz} width={rect.hx * 2} height={rect.hz * 2} rx={0.08} style={{ fill: item.plan }} />
                  {!item.floor && <circle cx={rect.x + backX * 0.8} cy={-rect.z + backY * 0.8} r={0.07} className="plan-back" />}
                  <text x={rect.x} y={-rect.z} className="plan-label">{item.short}</text>
                </g>
              );
            })}
          </svg>
          {selectedPiece ? (
            <div className="designer-toolbar" data-testid="designer-toolbar">
              <strong>{selectedPiece.name}<small>{whereIs(selectedPiece.x, selectedPiece.z).replace(" in the ", " · ") || " · open floor"}</small></strong>
              <span className="designer-nudge" aria-label="Nudge">
                {([["←", -0.5, 0], ["↑", 0, 0.5], ["↓", 0, -0.5], ["→", 0.5, 0]] as const).map(([arrow, dx, dz]) => (
                  <button key={arrow} className="secondary" disabled={busy || !owner} onClick={() => nudge(dx, dz)} aria-label={`Nudge ${arrow}`}>{arrow}</button>
                ))}
              </span>
              <button className="secondary" disabled={busy || !owner} onClick={turn}>⟳ Turn</button>
              <button className="secondary" disabled={busy || !owner} onClick={() => {
                setSelected(null);
                void run(`${selectedPiece.name} picked up and back in your bag.`, () => api.removeFurniture(propertyId, selectedPiece.id));
              }}>Pick up</button>
              <div className="designer-rooms">
                <span className="muted small">Move to:</span>
                {layout.rooms.map((room) => (
                  <button key={room.room} className="chip" disabled={busy || !owner} onClick={() => moveTo(selectedPiece, room.room)} data-testid={`move-to-${room.room}`}>
                    {ROOM_NAMES[room.room]}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted small">{owner ? "Drag furniture to move it. Tap a piece to turn it or pick it up. The dot marks its back." : "Only the owner can rearrange this home."}</p>
          )}
          {owner && misplaced.length > 0 && (
            <div className="designer-misplaced" data-testid="designer-misplaced">
              <span>
                {misplaced.length === 1
                  ? `The ${misplaced[0]!.piece.name.toLowerCase()} belongs in the ${ROOM_NAMES[misplaced[0]!.room].toLowerCase()}.`
                  : `${misplaced.length} pieces are in the wrong room.`}
              </span>
              <button className="primary" disabled={busy} onClick={tidyUp} data-testid="designer-tidy">{misplaced.length === 1 ? "Move it there" : "Put everything in its room"}</button>
            </div>
          )}
          {owner && interior && interior.availableFurniture.length > 0 && (
            <div className="designer-bag">
              <span className="muted small">In your bag:</span>
              {interior.availableFurniture.map((item) => (
                <button key={item.itemId} className="chip" disabled={busy} onClick={() => placeNew(item.itemId, item.name)}>
                  + {item.name}{item.available > 1 ? ` ×${item.available}` : ""}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "parking" && <HomeParking propertyId={propertyId} homeName={homeName} door={door} owner={owner} onToast={onToast} onRefresh={onRefresh} />}

      {tab === "shop" && (
        <ul className="designer-shop">
          {FURNITURE.map((item) => {
            const inBag = interior?.availableFurniture.find((entry) => entry.itemId === item.id)?.available ?? 0;
            return (
              <li key={item.id}>
                <i style={{ background: item.plan }} />
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.description}</span>
                  <em>{item.size[0]} × {item.size[1]} m{inBag ? ` · ${inBag} in your bag` : ""}</em>
                </div>
                <button className="primary" disabled={busy || !owner || balance < item.price} onClick={() => buyAndPlace(item.id)}>
                  {balance < item.price ? `Need ${naira(item.price)}` : `Buy ${naira(item.price)}`}
                </button>
              </li>
            );
          })}
          <li className="muted small">Delivered straight to your home by Home &amp; Style Furnishings. Fictional game naira only.</li>
        </ul>
      )}

      {tab === "guests" && (
        <div className="designer-body">
          <p className="muted">Invite a friend by their username. They get a message, the house shows up in their Phone → My Home with directions, and your door opens for them. They see your furniture change live while they are inside.</p>
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              const name = friend.trim();
              if (name.length < 3) return;
              void run(`${name} is invited. They can now let themselves in.`, async () => {
                await api.inviteGuest(propertyId, name);
                setFriend("");
              });
            }}
          >
            <input value={friend} onChange={(event) => setFriend(event.target.value)} placeholder="Friend's username" maxLength={20} aria-label="Friend's username" />
            <button className="primary" disabled={busy || !owner || friend.trim().length < 3}>Invite</button>
          </form>
          <ul className="designer-guests">
            {(interior?.guests ?? []).map((name) => (
              <li key={name}>
                <span>{name}</span>
                <button className="link" disabled={busy || !owner} onClick={() => void run(`${name} can no longer let themselves in.`, () => api.removeGuest(propertyId, name))}>Remove</button>
              </li>
            ))}
            {interior && interior.guests.length === 0 && <li className="muted small">No guests yet.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
