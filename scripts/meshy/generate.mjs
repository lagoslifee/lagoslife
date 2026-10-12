#!/usr/bin/env node
// Development-time Meshy asset pipeline. Runs locally with MESHY_API_KEY from
// apps/server/.env; the key is never bundled into browser code.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const logPath = path.join(root, "docs/asset-generation-log.json");
const envPath = path.join(root, "apps/server/.env");

if (!process.env.MESHY_API_KEY && existsSync(envPath)) {
  for (const line of (await readFile(envPath, "utf8")).split("\n")) {
    const match = line.match(/^MESHY_API_KEY=(.+)$/);
    if (match) process.env.MESHY_API_KEY = match[1].trim();
  }
}
const key = process.env.MESHY_API_KEY;
if (!key) throw new Error("MESHY_API_KEY is not configured in apps/server/.env");

const MAX_CREDITS_PER_RUN = Number(process.env.MESHY_MAX_CREDITS ?? 120);
let spent = 0;

async function api(method, endpoint, body) {
  const response = await fetch(`https://api.meshy.ai/openapi${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${endpoint} -> ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function readLog() {
  return existsSync(logPath) ? JSON.parse(await readFile(logPath, "utf8")) : { tasks: [] };
}

async function record(entry) {
  const log = await readLog();
  log.tasks.push({ ...entry, recordedAt: new Date().toISOString() });
  await writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`);
}

async function waitFor(endpoint, id, label) {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const task = await api("GET", `${endpoint}/${id}`);
    if (task.status === "SUCCEEDED") {
      spent += task.consumed_credits ?? 0;
      await record({
        label,
        endpoint,
        id,
        status: task.status,
        consumedCredits: task.consumed_credits ?? null,
        thumbnail: task.thumbnail_url ? task.thumbnail_url.split("?")[0] : null,
      });
      console.log(`${label} succeeded (${task.consumed_credits ?? "?"} credits)`);
      return task;
    }
    if (["FAILED", "CANCELED"].includes(task.status)) {
      await record({ label, endpoint, id, status: task.status, error: task.task_error });
      throw new Error(`${label} ${task.status}: ${JSON.stringify(task.task_error)}`);
    }
    if (attempt % 6 === 0) console.log(`${label}: ${task.status} ${task.progress ?? 0}%`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`${label} timed out`);
}

function guardBudget(next) {
  if (spent + next > MAX_CREDITS_PER_RUN) {
    throw new Error(`Credit guard: ${spent} spent, next step ${next}, cap ${MAX_CREDITS_PER_RUN}`);
  }
}

async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status} for ${target}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  console.log(`saved ${path.relative(root, target)}`);
}

const outDir = path.join(root, "assets-source/meshy");

async function generateModel({ label, prompt, texturePrompt, pose, polycount }) {
  guardBudget(30);
  const preview = await api("POST", "/v2/text-to-3d", {
    mode: "preview",
    prompt,
    ai_model: "latest",
    should_remesh: true,
    topology: "triangle",
    target_polycount: polycount,
    ...(pose ? { pose_mode: pose } : {}),
    target_formats: ["glb"],
    moderation: true,
  });
  await waitFor("/v2/text-to-3d", preview.result, `${label} preview`);
  const refine = await api("POST", "/v2/text-to-3d", {
    mode: "refine",
    preview_task_id: preview.result,
    enable_pbr: true,
    texture_resolution: "2k",
    texture_prompt: texturePrompt,
    target_formats: ["glb"],
    moderation: true,
  });
  const refined = await waitFor("/v2/text-to-3d", refine.result, `${label} refine`);
  await download(refined.model_urls.glb, path.join(outDir, `${label}.glb`));
  if (refined.thumbnail_url) {
    await download(refined.thumbnail_url, path.join(outDir, `${label}-thumbnail.png`));
  }
  return refine.result;
}

const target = process.argv[2];

if (target === "avatar") {
  const taskId = await generateModel({
    label: "resident-avatar",
    prompt:
      "Full body semi-realistic young Nigerian man, deep brown skin, short low-cut hair, " +
      "natural adult human proportions, wearing a fitted short-sleeve button shirt with a " +
      "subtle ankara print, dark slim chinos, clean white sneakers, neutral face, " +
      "standing in A-pose, arms away from body, game character",
    texturePrompt:
      "realistic skin with natural brown tones, woven cotton shirt with blue and orange " +
      "ankara pattern, dark navy chinos, white canvas sneakers",
    pose: "a-pose",
    polycount: 30000,
  });
  guardBudget(5);
  const rig = await api("POST", "/v1/rigging", { input_task_id: taskId, height_meters: 1.76 });
  const rigged = await waitFor("/v1/rigging", rig.result, "resident-avatar rig");
  await download(rigged.result.rigged_character_glb_url, path.join(outDir, "resident-avatar-rigged.glb"));
  // Idle, Casual Walk, Run 2 (jog), Run Fast (sprint), Chair Sit Idle Male,
  // Stand to Sit, Sit to Stand Male, Big Wave Hello, Jump Run, Boom Dance.
  const actions = [0, 30, 14, 16, 33, 57, 53, 28, 13, 66];
  guardBudget(actions.length * 3);
  const animation = await api("POST", "/v1/animations", {
    rig_task_id: rig.result,
    action_ids: actions,
  });
  const animated = await waitFor("/v1/animations", animation.result, "resident-avatar animations");
  await download(animated.result.animation_glb_url, path.join(outDir, "resident-avatar-animated.glb"));
} else if (target === "danfo") {
  await generateModel({
    label: "danfo-shell",
    prompt:
      "Unbranded boxy 1980s passenger minibus used as a Lagos danfo, bright yellow paint " +
      "with two thin black horizontal stripes along the sides, sliding side door, " +
      "roof rack, slightly worn, realistic vehicle, no logos, no text",
    texturePrompt:
      "glossy yellow automotive paint with light dust and wear, black stripe decals, " +
      "chrome bumpers, dark tinted glass, black rubber tyres",
    polycount: 20000,
  });
} else if (target === "cars") {
  const { REAL_CARS } = await import("./real-cars.mjs");
  const wanted = process.argv.slice(3);
  const queue = REAL_CARS.filter((car) => (!wanted.length || wanted.includes(car.id)) && !existsSync(path.join(outDir, `car-${car.id}.glb`)));
  const failures = [];
  const worker = async () => {
    for (let car = queue.shift(); car; car = queue.shift()) {
      try {
        await generateModel({
          label: `car-${car.id}`,
          prompt:
            `${car.model}, realistic detailed production car exterior, accurate real-world proportions, ` +
            "glossy solid white paint, dark tinted windows, black tyres on alloy wheels, headlights and tail lights, " +
            "four wheels touching the ground, no number plate text, no people",
          texturePrompt:
            `${car.name} in glossy solid white automotive paint, dark tinted glass, black rubber tyres, ` +
            "silver alloy wheels, clear headlights, red tail lights, black grille and trim",
          polycount: 30000,
        });
      } catch (error) {
        failures.push(car.id);
        console.error(`car-${car.id} failed: ${error.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Number(process.env.MESHY_CONCURRENCY ?? 5) }, worker));
  if (failures.length) console.log(`failed: ${failures.join(" ")}`);
} else if (target === "props") {
  const PROPS = [
    {
      label: "prop-immigration-booth",
      prompt:
        "Airport immigration passport control desk, a waist-high dark walnut wood counter with a white quartz top, " +
        "a curved frosted glass partition on top, a small stainless steel canopy above, two computer monitors, " +
        "realistic, single object, no people, no text",
      texturePrompt: "dark walnut wood panels, white quartz counter top, frosted glass, brushed stainless steel canopy",
    },
    {
      label: "prop-checkin-counter",
      prompt:
        "Airline check-in counter with a luggage weighing scale and short conveyor belt beside it, modern airport " +
        "design, white and navy blue panels, computer monitor on the desk, realistic, single object, no people, no text",
      texturePrompt: "white laminate desk with navy blue front panels, black rubber conveyor belt, brushed steel scale",
    },
    {
      label: "prop-restaurant-table",
      prompt:
        "Outdoor restaurant dining set: a square wooden table with four wooden chairs and a large cream canvas patio " +
        "umbrella in the middle, realistic, single object on the ground, no people, no text",
      texturePrompt: "warm teak wood table and chairs, cream canvas umbrella, dark metal umbrella pole",
    },
    {
      label: "prop-treadmill",
      prompt: "Commercial gym treadmill with a black running belt, handrails and a console screen, realistic, single object, no people, no text",
      texturePrompt: "matte black rubber belt, dark grey plastic frame, brushed aluminium handrails, glossy black console",
    },
    {
      label: "prop-weight-bench",
      prompt:
        "Gym flat weight bench with an upright barbell rack, a steel barbell with black weight plates resting on the rack, " +
        "realistic, single object, no people, no text",
      texturePrompt: "black padded leather bench, matte black steel frame, chrome barbell, black rubber weight plates",
    },
    {
      label: "prop-dumbbell-rack",
      prompt: "Two-tier gym dumbbell rack holding ten pairs of hexagonal rubber dumbbells, realistic, single object, no people, no text",
      texturePrompt: "black steel rack, black rubber hex dumbbells with chrome handles",
    },
    {
      label: "prop-generator",
      prompt:
        "Large soundproof diesel generator set on a steel skid, boxy green canopy with louvred side vents, a control panel door, " +
        "an exhaust pipe on top, realistic, single object, no people, no text, no logos",
      texturePrompt: "dark green powder-coated steel canopy with light dust, black louvres, grey control panel, rusty exhaust",
    },
    {
      label: "prop-double-bed",
      prompt: "Modern double bed with a padded upholstered headboard, white sheets, two pillows and a folded throw, realistic, single object, no people",
      texturePrompt: "grey fabric headboard, crisp white cotton sheets, mustard yellow throw, dark wood legs",
    },
    {
      label: "prop-sofa",
      prompt: "Modern three-seater living room sofa with cushions, realistic, single object, no people",
      texturePrompt: "soft beige fabric upholstery, two teal throw cushions, dark wooden legs",
    },
    {
      label: "prop-dining-set",
      prompt: "Indoor dining table for six with six upholstered chairs around it, realistic, single object, no people",
      texturePrompt: "polished walnut table top, cream upholstered chairs, dark wood legs",
    },
    {
      label: "prop-gas-cooker",
      prompt: "Freestanding kitchen cooker with an oven, four gas burners on top, simple box shape, realistic, single object, no text",
      texturePrompt: "brushed stainless steel, black glass oven door, black cast iron burner grates",
    },
    {
      label: "prop-standing-fan",
      prompt: "Standing electric pedestal fan with a round wire guard and three blades on a tall pole and round base, realistic, single object, no text",
      texturePrompt: "white plastic body, white wire guard, translucent blue blades, chrome pole",
    },
    {
      label: "prop-king-bed",
      prompt:
        "Luxury hotel king size bed with a tall tufted upholstered headboard, two matching bedside tables with small lamps, " +
        "plush white bedding, four pillows and a folded throw at the foot, realistic, single object, no people",
      texturePrompt: "lilac grey velvet tufted headboard, crisp white cotton bedding, dusty purple throw, walnut bedside tables, brass lamps with cream shades",
    },
    {
      label: "prop-sectional",
      prompt: "Large modern L-shaped sectional sofa with a chaise, deep seat cushions and scatter cushions, realistic, single object, no people",
      texturePrompt: "light grey woven fabric upholstery, mustard and cream scatter cushions, thin black metal legs",
    },
    {
      label: "prop-armchair",
      prompt: "Mid-century velvet lounge armchair with a curved back and slim wooden legs, realistic, single object, no people",
      texturePrompt: "mustard yellow velvet upholstery, walnut wood legs",
    },
    {
      label: "prop-coffee-table",
      prompt: "Low rectangular white marble coffee table with a black metal base, a small vase and two books on top, realistic, single object",
      texturePrompt: "polished white carrara marble with grey veins, matte black metal base, ceramic vase, hardback books",
    },
    {
      label: "prop-side-table",
      prompt: "Small rectangular wooden side table with a woven rattan lower shelf and a potted succulent on top, realistic, single object",
      texturePrompt: "warm teak wood, natural woven rattan shelf, terracotta pot",
    },
    {
      label: "prop-tv-console",
      prompt: "Large flat screen television on a long low modern media console with drawers, a soundbar under the screen, realistic, single object, no text",
      texturePrompt: "glossy black television screen with thin bezel, dark walnut media console with brass handles, black soundbar",
    },
    {
      label: "prop-wardrobe",
      prompt: "Tall modern double sliding door wardrobe with full height mirrored doors, simple box shape, realistic, single object",
      texturePrompt: "cream lacquered wood frame, silver mirror glass doors, brushed steel trim",
    },
    {
      label: "prop-bookshelf",
      prompt: "Tall open wooden bookshelf with five shelves filled with books, small plants and keepsakes, realistic, single object",
      texturePrompt: "walnut wood shelves, colourful book spines, green plants, ceramic ornaments",
    },
    {
      label: "prop-work-desk",
      prompt: "Modern home office desk with an open laptop and a desk lamp, and a black ergonomic office chair tucked in, realistic, single object, no text",
      texturePrompt: "white oak desk top, black metal legs, silver laptop, black mesh office chair",
    },
    {
      label: "prop-floor-lamp",
      prompt: "Brass arc floor lamp with a curved arm, a round marble base and a dome lamp shade, realistic, single object",
      texturePrompt: "polished brass arm, white marble base, cream fabric dome shade",
    },
    {
      label: "prop-potted-palm",
      prompt: "Tall indoor areca palm plant in a large round ceramic planter, lush green fronds, realistic, single object",
      texturePrompt: "vivid green palm fronds, matte terracotta ceramic planter",
    },
    {
      label: "prop-grand-piano",
      prompt: "Glossy black concert grand piano with the lid propped open and a matching piano bench, realistic, single object, no text",
      texturePrompt: "high gloss black lacquer, white and black ivory keys, polished brass pedals, gold strings inside",
    },
    {
      label: "prop-chandelier",
      prompt:
        "Large luxury crystal chandelier for a mansion foyer, three tiers of hanging crystal drops on a gold frame, " +
        "candle style lights, realistic, single object",
      texturePrompt: "polished gold metal frame, clear sparkling crystal drops, warm white candle bulbs",
    },
    {
      label: "prop-kitchen-island",
      prompt:
        "Modern luxury kitchen island with a thick white marble waterfall counter top, a built in sink, and three upholstered " +
        "bar stools along one side, realistic, single object, no people",
      texturePrompt: "white calacatta marble with gold veins, matte navy blue cabinet fronts, brass tap, cream leather stools with brass legs",
    },
    {
      label: "prop-kitchen-wall",
      prompt:
        "Straight run of modern fitted kitchen cabinets against a wall: tall fridge, built in oven, a gas hob, upper cabinets " +
        "and a marble backsplash, simple flat back, realistic, single object, no text",
      texturePrompt: "matte navy blue cabinet doors with brass handles, white marble counter and backsplash, stainless steel fridge and oven",
    },
    {
      label: "prop-wall-art",
      prompt: "Large framed abstract canvas painting, a modern African inspired abstract artwork in a thin gold frame, flat rectangular panel, realistic, single object",
      texturePrompt: "abstract painting in ochre, indigo, terracotta and gold brush strokes, thin gold frame",
    },
    {
      label: "prop-console-vase",
      prompt: "Narrow marble hallway console table with a tall ceramic vase of white orchids and a round mirror above it, realistic, single object",
      texturePrompt: "white marble top, brushed gold legs, white ceramic vase, white orchid flowers, gold framed round mirror",
    },
    {
      label: "prop-helicopter",
      prompt:
        "Modern private executive light helicopter parked on the ground, sleek enclosed cabin with tinted windows, " +
        "four bladed main rotor, tail boom with tail rotor, landing skids, realistic, single object, no text, no logos",
      texturePrompt: "glossy black and gold paint, dark tinted cabin glass, silver rotor blades, black landing skids",
    },
    {
      label: "prop-squat-rack",
      prompt: "Commercial gym power rack squat cage with a loaded steel barbell on the hooks and black bumper plates on storage pegs, realistic, single object, no people, no text",
      texturePrompt: "matte black steel cage, chrome barbell, black rubber bumper plates, red accents on the uprights",
    },
    {
      label: "prop-exercise-bike",
      prompt: "Commercial gym upright stationary exercise bike with a padded seat, handlebars and a console screen, realistic, single object, no people, no text",
      texturePrompt: "matte black frame, dark grey plastic covers, black padded seat, glossy black console, red flywheel accent",
    },
  ];
  const wanted = process.argv.slice(3);
  const queue = PROPS.filter((prop) => (!wanted.length || wanted.includes(prop.label)) && !existsSync(path.join(outDir, `${prop.label}.glb`)));
  const failures = [];
  await Promise.all(
    queue.map(async (prop) => {
      try {
        await generateModel({ ...prop, polycount: 15000 });
      } catch (error) {
        failures.push(prop.label);
        console.error(`${prop.label} failed: ${error.message}`);
      }
    }),
  );
  if (failures.length) console.log(`failed: ${failures.join(" ")}`);
} else {
  console.log("usage: node scripts/meshy/generate.mjs <avatar|danfo|cars [id...]|props [label...]>");
  process.exit(1);
}
console.log(`credits spent this run: ${spent}`);
