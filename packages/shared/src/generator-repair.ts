import { z } from "zod";

/**
 * Generator repair gig: the server picks one real fault per job. Inspect parts to find it, apply the matching fix, then
 * pull-start the generator. You are paid only once it runs. Fixing a part needs an inspection of that part first.
 */
export const GENERATOR_FAULTS = ["fuel", "plug", "filter", "oil"] as const;
export type GeneratorFault = (typeof GENERATOR_FAULTS)[number];

export const REPAIR_ACTIONS = [
  "inspect-fuel",
  "inspect-plug",
  "inspect-filter",
  "inspect-oil",
  "refuel",
  "replace-plug",
  "clean-filter",
  "top-oil",
  "pull-start",
] as const;
export type RepairAction = (typeof REPAIR_ACTIONS)[number];

/** Minimum time between two actions, so each one plays out at the machine. */
export const REPAIR_ACTION_MS = 3_000;

export const REPAIR_LABEL: Record<RepairAction, string> = {
  "inspect-fuel": "Check fuel tank",
  "inspect-plug": "Check spark plug",
  "inspect-filter": "Check air filter",
  "inspect-oil": "Check oil (dipstick)",
  refuel: "Pour in fuel",
  "replace-plug": "Fit a new spark plug",
  "clean-filter": "Clean the air filter",
  "top-oil": "Top up engine oil",
  "pull-start": "Pull the starter cord",
};

const PART: Record<GeneratorFault, { inspect: RepairAction; fix: RepairAction; bad: string; good: string; fixed: string; wasted: string }> = {
  fuel: { inspect: "inspect-fuel", fix: "refuel", bad: "The tank is bone dry. It needs fuel.", good: "The tank is three-quarters full.", fixed: "You pour in 10 litres of petrol.", wasted: "You add fuel, but the tank was already full enough." },
  plug: { inspect: "inspect-plug", fix: "replace-plug", bad: "The spark plug is black with carbon. No spark.", good: "The spark plug is clean and sparks fine.", fixed: "You screw in a new spark plug.", wasted: "You swap the plug, but the old one was fine." },
  filter: { inspect: "inspect-filter", fix: "clean-filter", bad: "The air filter is packed with dust. The engine is choking.", good: "The air filter is clean.", fixed: "You knock out the dust and blow the filter clean.", wasted: "You clean the filter, but it was already clean." },
  oil: { inspect: "inspect-oil", fix: "top-oil", bad: "The dipstick is dry. The low-oil cut-off stops the engine.", good: "Oil is at the full mark.", fixed: "You top the oil up to the full mark.", wasted: "You add oil, but it was already full." },
};

export type RepairState = { fault: GeneratorFault; inspected: GeneratorFault[]; fixed: boolean; running: boolean; pulls: number; log: string[] };
/** What the client sees: the fault stays hidden until you inspect the right part. */
export type RepairView = { inspected: GeneratorFault[]; fixed: boolean; running: boolean; log: string[] };

export const newRepair = (fault: GeneratorFault): RepairState => ({ fault, inspected: [], fixed: false, running: false, pulls: 0, log: [] });
export const repairView = (state: RepairState): RepairView => ({ inspected: state.inspected, fixed: state.fixed, running: state.running, log: state.log });

export function applyRepair(state: RepairState, action: RepairAction): { state: RepairState; message: string; ok: boolean } {
  if (state.running) return { state, message: "The generator is already running.", ok: false };
  const next: RepairState = { ...state, inspected: [...state.inspected], log: [...state.log] };
  let message: string;
  const inspecting = GENERATOR_FAULTS.find((part) => PART[part].inspect === action);
  const fixing = GENERATOR_FAULTS.find((part) => PART[part].fix === action);
  if (inspecting) {
    message = inspecting === state.fault && !state.fixed ? PART[inspecting].bad : PART[inspecting].good;
    if (!next.inspected.includes(inspecting)) next.inspected.push(inspecting);
  } else if (fixing) {
    if (!state.inspected.includes(fixing)) return { state, message: `${REPAIR_LABEL[PART[fixing].inspect]} before you work on it.`, ok: false };
    if (fixing === state.fault) {
      next.fixed = true;
      message = PART[fixing].fixed;
    } else message = PART[fixing].wasted;
  } else {
    next.pulls += 1;
    if (state.fixed) {
      next.running = true;
      message = "It coughs once, then roars into life. The lights come on.";
    } else message = next.pulls > 2 ? "It still won't start. Something is wrong; check each part." : "It turns over but won't start.";
  }
  next.log = [...next.log, message].slice(-8);
  return { state: next, message, ok: true };
}

export const repairSchema = z.object({ action: z.enum(REPAIR_ACTIONS) });
