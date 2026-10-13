import {
  EXTERIOR_PAINTS,
  finishPrice,
  floorFinish,
  FLOOR_FINISHES,
  interiorStyle,
  INTERIOR_STYLES,
  listingTemplateId,
  type FloorFinishId,
  type HomeFinish,
  type HomeTier,
} from "@lagos-living/shared";
import { naira } from "../api";

type Props = {
  propertyId: string;
  tier: HomeTier;
  finish: HomeFinish | null;
  balance: number;
  busy: boolean;
  onChoose: (parts: { style?: string; floor?: FloorFinishId; exterior?: string }, label: string) => void;
};

const css = ([r, g, b]: [number, number, number]) => `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

/** Swatch colours for each floor, matching how they are drawn in the room. */
const FLOOR_SWATCH: Record<FloorFinishId, string> = {
  oak: "linear-gradient(90deg, #a87a4a 0 30%, #b58654 30% 62%, #9c6f42 62%)",
  walnut: "repeating-linear-gradient(45deg, #5c3a24 0 6px, #4a2e1c 6px 12px)",
  terrazzo: "radial-gradient(circle at 20% 30%, #9b4a2c 2px, transparent 3px), radial-gradient(circle at 70% 60%, #3f6b4f 2px, transparent 3px), radial-gradient(circle at 45% 80%, #c99b52 2px, transparent 3px), #d9c9ac",
  travertine: "linear-gradient(135deg, #d5bd95, #c4a87e)",
  "black-marble": "linear-gradient(135deg, #1c1b1d 0 45%, #b8945a 46% 48%, #1c1b1d 49%)",
  "cream-marble": "linear-gradient(135deg, #ece3d2 0 45%, #b5a892 46% 47%, #ece3d2 48%)",
  terracotta: "repeating-linear-gradient(0deg, #b05c3a 0 14px, #e1cdb4 14px 16px)",
  "flat-tiles": "repeating-linear-gradient(0deg, #d8cdb8 0 14px, #b8ad98 14px 15px)",
};

/** Paint & style: the decorators restyle, refloor and (for houses you built) repaint the outside, for a fee. */
export function HomeDecorator({ propertyId, tier, finish, balance, busy, onChoose }: Props) {
  const current = interiorStyle(finish?.style, tier);
  const currentFloor = floorFinish(finish, tier);
  const built = listingTemplateId(propertyId).startsWith("built-");
  const stylePrice = finishPrice("style", tier);
  const floorPrice = finishPrice("floor", tier);
  const paintPrice = finishPrice("exterior", tier);
  return (
    <div className="designer-body decorator" data-testid="home-decorator">
      <p className="muted small">Ankara &amp; Oak Decorators come round the same day. A style repaints every wall, hangs a new feature-wall print and lays its floor.</p>
      <h3>Interior style</h3>
      <ul className="decor-styles">
        {INTERIOR_STYLES.map((style) => {
          const chosen = style.id === current.id;
          return (
            <li key={style.id} className={chosen ? "chosen" : ""}>
              <div className="decor-swatch" aria-hidden>
                <i style={{ background: css(style.upper) }} />
                <i style={{ background: `repeating-linear-gradient(45deg, ${style.print.ground} 0 5px, ${style.print.ink} 5px 8px)` }} />
                <i style={{ background: css(style.lower) }} />
                <i style={{ background: FLOOR_SWATCH[style.floor] }} />
              </div>
              <div>
                <strong>{style.name}</strong>
                <span>{style.blurb}</span>
              </div>
              {chosen ? (
                <em className="decor-current">Your style</em>
              ) : (
                <button className="primary" disabled={busy || balance < stylePrice} onClick={() => onChoose({ style: style.id }, `${style.name} — the decorators have finished. Welcome home.`)} data-testid={`style-${style.id}`}>
                  {balance < stylePrice ? `Need ${naira(stylePrice)}` : naira(stylePrice)}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <h3>Floor <small className="muted">{naira(floorPrice)}</small></h3>
      <div className="decor-floors">
        {FLOOR_FINISHES.map((floor) => (
          <button
            key={floor.id}
            className={`decor-floor ${floor.id === currentFloor ? "chosen" : ""}`}
            disabled={busy || floor.id === currentFloor || balance < floorPrice}
            onClick={() => onChoose({ floor: floor.id }, `${floor.name} laid.`)}
            title={floor.blurb}
            data-testid={`floor-${floor.id}`}
          >
            <i style={{ background: FLOOR_SWATCH[floor.id] }} />
            <span>{floor.name}</span>
          </button>
        ))}
      </div>
      <h3>Outside paint <small className="muted">{naira(paintPrice)}</small></h3>
      {built ? (
        <div className="decor-paints">
          {EXTERIOR_PAINTS.map((paint) => (
            <button
              key={paint.id}
              className={`decor-paint ${paint.id === (finish?.exterior ?? "white") ? "chosen" : ""}`}
              disabled={busy || paint.id === (finish?.exterior ?? "white") || balance < paintPrice}
              onClick={() => onChoose({ exterior: paint.id }, `The painters have done the outside in ${paint.name.toLowerCase()}.`)}
              data-testid={`paint-${paint.id}`}
            >
              <i style={{ background: paint.colour }} />
              <span>{paint.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted small">The outside of this building belongs to the estate. Build your own house on a plot to choose its colour.</p>
      )}
    </div>
  );
}
