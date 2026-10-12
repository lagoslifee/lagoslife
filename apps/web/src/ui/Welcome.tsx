import { HOUSE_DESIGNS, PLOT_TERMS } from "@lagos-living/shared";
import { naira, type EconomyState, type PropertyListing } from "../api";
import { keyLabel, type Bindings } from "../game/controller";
import type { HousingPath } from "./objectives";
import { RENTAL_ID, SALE_ID } from "./objectives";
import { buildingUnits } from "./Sheets";

type Props = {
  playerName: string;
  economy: EconomyState | null;
  properties: PropertyListing[];
  touch: boolean;
  bindings: Bindings;
  onChoose: (path: HousingPath | null) => void;
};

export function Welcome({ playerName, economy, properties, touch, bindings, onChoose }: Props) {
  const key = (action: keyof Bindings) => <kbd>{keyLabel(bindings[action])}</kbd>;
  const balance = economy?.balance ?? 0;
  const rental = buildingUnits(properties, RENTAL_ID).offered;
  const sale = buildingUnits(properties, SALE_ID).offered;
  const cheapestBuild = PLOT_TERMS.leaseRent + Math.min(...HOUSE_DESIGNS.map((design) => design.stages.foundation.cost));
  const options: Array<{ path: HousingPath; icon: string; title: string; cost: string; detail: string }> = [
    {
      path: "rent",
      icon: "🔑",
      title: "Rent a flat",
      cost: rental ? `${naira(rental.upfrontRent)} upfront` : "Adebayo Court",
      detail: "Move in today. Cheapest start; rent is due every week.",
    },
    {
      path: "buy",
      icon: "🏠",
      title: "Buy a house",
      cost: sale ? naira(sale.purchasePrice) : "Okoro Terrace",
      detail: sale && sale.purchasePrice > balance / 2 ? "Yours outright, no rent — but it takes most of your money." : "Yours outright: no rent, ever.",
    },
    {
      path: "build",
      icon: "🧱",
      title: "Lease land & build",
      cost: `from ${naira(cheapestBuild)} to start`,
      detail: "Get a plot, pick a cottage, bungalow or duplex, and pay the builders stage by stage while you work.",
    },
  ];
  return (
    <div className="modal-backdrop welcome-backdrop">
      <section className="welcome" role="dialog" aria-labelledby="welcome-title" data-testid="welcome">
        <p className="eyebrow">WELCOME TO NAIJA WORLD, {playerName.toUpperCase()}</p>
        <h2 id="welcome-title">Live a life in Lagos — with real people</h2>
        <p className="welcome-lead">
          Everyone you see walking or driving with a name over their head is another real player. You have <strong>{naira(balance)}</strong> game naira
          and a room for tonight in Lekki.
        </p>
        <ul className="welcome-things" aria-label="Things to do">
          <li><span aria-hidden>🏠</span>Get a home</li>
          <li><span aria-hidden>🚗</span>Buy or rent a car</li>
          <li><span aria-hidden>🍾</span>Clubs at night</li>
          <li><span aria-hidden>✈️</span>Fly to Dubai</li>
          <li><span aria-hidden>📍</span>Phone → Go now to travel fast</li>
        </ul>
        <h3 className="welcome-step">Start here: where will you live?</h3>
        <div className="welcome-options">
          {options.map((option) => (
            <button key={option.path} className="welcome-option" onClick={() => onChoose(option.path)} data-testid={`welcome-${option.path}`}>
              <span className="welcome-icon" aria-hidden>{option.icon}</span>
              <span className="welcome-text">
                <strong>{option.title}</strong>
                <em>{option.cost}</em>
                <span>{option.detail}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="welcome-controls">
          {touch ? (
            <>
              <span><b>Left thumb</b> drag the circle to walk</span>
              <span><b>Right thumb</b> drag to look around</span>
              <span><b>Tap ✋</b> or the prompt to use doors and signs</span>
            </>
          ) : (
            <>
              <span>{key("forward")}{key("left")}{key("back")}{key("right")} walk · {key("sprint")} sprint</span>
              <span><b>Mouse</b> look (click the game to lock)</span>
              <span>{key("interact")} use doors and signs · {key("map")} map · {key("phone")} phone</span>
            </>
          )}
        </div>
        <button className="link welcome-skip" onClick={() => onChoose(null)}>I’ll decide later — just let me explore</button>
      </section>
    </div>
  );
}
