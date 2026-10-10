import { constructionStages } from "@lagos-living/shared";
import type { PlotState } from "../api";

/** How far along a plot's build is, for drawing. Stage index 0..3 plus the fraction of that stage done. */
export function buildProgress(construction: NonNullable<PlotState["construction"]>, now: number) {
  const stage = construction.stagesPaid - 1;
  const started = Date.parse(construction.stageStartedAt);
  const ready = Date.parse(construction.stageReadyAt);
  const fraction = construction.completed ? 1 : Math.max(0, Math.min(1, (now - started) / Math.max(1, ready - started)));
  return { stage, fraction, waitingForPayment: !construction.completed && fraction >= 1 && stage < constructionStages.length - 1 };
}
