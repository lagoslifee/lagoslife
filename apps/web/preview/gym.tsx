import { createRoot } from "react-dom/client";
import { getPlace, GYM } from "@lagos-living/shared";
import { GymSheet } from "../src/ui/GymSheet";
const fitness = Number(new URLSearchParams(location.search).get("f") ?? "0.3");
const realFetch = window.fetch;
window.fetch = async (input, init) => {
  if (String(input).includes("/api/gym")) return new Response(JSON.stringify({ fitness, energy: 80, memberUntil: new Date(Date.now() + 9e8).toISOString(), set: null, peopleHere: ["Tobi"] }), { headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};
createRoot(document.getElementById("root")!).render(<GymSheet place={getPlace(GYM.placeId)} balance={500000} onClose={() => {}} onRefresh={async () => {}} onToast={() => {}} onTrain={() => true} />);
