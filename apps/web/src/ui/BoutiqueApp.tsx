import { BOUTIQUE, type Notice } from "@lagos-living/shared";
import { useState } from "react";
import { api, naira, type EconomyState } from "../api";
import type { GameEngine } from "../game/engine";
import { OUTFITS, type Fabric } from "../game/wardrobe";

type Props = {
  engine: GameEngine | null;
  economy: EconomyState | null;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
};

const swatch = (fabric: Fabric | null) =>
  !fabric ? "transparent" : fabric.print ? `repeating-linear-gradient(135deg, ${fabric.colour} 0 7px, ${fabric.print.colour} 7px 10px, ${fabric.colour} 10px 14px, ${fabric.print.accent} 14px 16px)` : fabric.colour;

/** Phone → Boutique: the collection cut for the player's body, bought with game naira and worn straight away. */
export function BoutiqueApp({ engine, economy, onRefresh, onToast }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const appearance = engine?.currentAppearance();
  const body = appearance?.body ?? "male";
  const items = BOUTIQUE.filter((item) => item.body === body);
  const owned = new Set(economy?.inventory.map((entry) => entry.itemId) ?? []);
  const balance = economy?.balance ?? 0;

  const wear = async (outfit: (typeof BOUTIQUE)[number]["outfit"]) => {
    if (!engine) return;
    const result = await api.saveAppearance({ ...engine.currentAppearance(), outfit });
    engine.setAppearance(result.appearance);
    window.dispatchEvent(new CustomEvent("lagos-appearance", { detail: result.appearance }));
  };
  const run = async (key: string, work: () => Promise<string>) => {
    setBusy(key);
    try {
      onToast({ tone: "success", text: await work() });
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="app-section boutique-app" data-testid="boutique-app">
      <div className="boutique-hero">
        <strong>Naija World Boutique</strong>
        <span>{body === "female" ? "Women's" : "Men's"} collection · delivered to your wardrobe instantly</span>
      </div>
      <ul className="boutique-grid">
        {items.map((item) => {
          const look = OUTFITS[item.outfit];
          const mine = owned.has(`outfit:${item.outfit}`);
          const wearing = appearance?.outfit === item.outfit;
          return (
            <li key={item.outfit} className="boutique-item" data-testid={`boutique-${item.outfit}`}>
              <div className="garment" aria-hidden>
                <i className={`garment-top${look.longSleeves ? " long" : ""}`} style={{ background: swatch(look.top) }} />
                {look.skirt ? <i className="garment-skirt" style={{ background: swatch(look.skirt) }} /> : <i className="garment-legs" style={{ background: swatch(look.trousers) }} />}
                <i className="garment-shoes" style={{ background: look.shoes }} />
              </div>
              <strong>{item.name}</strong>
              <small>{item.description}</small>
              <div className="boutique-buy">
                <span>{naira(item.price)}</span>
                {wearing ? (
                  <em>Wearing</em>
                ) : mine ? (
                  <button className="primary" disabled={busy !== null} onClick={() => void run(item.outfit, async () => { await wear(item.outfit); return `You changed into the ${item.name.toLowerCase()}.`; })}>Wear</button>
                ) : (
                  <button
                    className="primary"
                    disabled={busy !== null || balance < item.price}
                    onClick={() => void run(item.outfit, async () => {
                      await api.purchase(`outfit:${item.outfit}`);
                      await wear(item.outfit);
                      return `Bought and wearing the ${item.name.toLowerCase()}.`;
                    })}
                  >
                    {busy === item.outfit ? "…" : balance < item.price ? "Need more" : "Buy & wear"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="muted small">The collection follows the body you chose in the character studio (Phone → Settings → Customise character). Clothes you buy stay in your wardrobe.</p>
    </div>
  );
}
