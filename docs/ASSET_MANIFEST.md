# Asset manifest

Last updated: 2026-10-10

| ID | Asset | Source / licence | State | Notes |
|---|---|---|---|---|
| resident-v1 | `characters/resident-v1.glb` | Generated with Meshy (text-to-3D preview + refine, auto-rig, animation library) under the project's Meshy account; optimised with glTF Transform (`scripts/assets/optimize-models.mjs`) | Temporary (quality-review candidate) | One rigged resident with idle, walk, jog and sprint clips. Measured stride speeds (`scripts/assets/measure-gait.mjs`): walk 0.73, jog 4.35, sprint 6.1 m/s; playback rate is scaled by ground speed so feet do not slide. All residents currently share this mesh with per-instance albedo tints, so the character creator's saved choices are not yet shown on the 3D model. |
| danfo-shell-v1 | `vehicles/danfo-shell-v1.glb` | Generated with Meshy (text-to-3D preview + refine); optimised with glTF Transform | Temporary (quality-review candidate) | Yellow minibus shell. The roof destination board, door gap, seated driver and conductor are added in code. Visual front orientation is set by `DANFO_MODEL_YAW` and was checked in screenshots at stops. |
| cesium-man | `characters/cesium-man.glb` | © 2017 Cesium; [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CesiumMan); CC-BY 4.0 with trademark limitations | Fallback only | Kept for the character creator preview fallback; no longer used in the world. |
| pbr-textures | `textures/*.webp` (asphalt, concrete, dirt, grass, pavers, plaster ×2, roof, tiles) | Poly Haven 1k maps, CC0 | Temporary | Converted to WebP (1024² colour/normal, 256² roughness) by `scripts/assets/compress-textures.mjs`. |
| daylight-hdr | `sky/daylight-1k.hdr` | Poly Haven 1k daylight HDRI, CC0 (the exact HDRI slug was not recorded at download time and must be recorded before it is treated as final) | Temporary | Used only for image-based lighting and reflections. The visible sky is a vertex-coloured gradient dome generated in code, because HDR prefiltering renders black on some software GPUs. |
| code-world | Buildings, compounds, roads, kerbs, drains, signs, shelters, palms, lights, tanks, interiors, ambient cars | Generated at runtime by project code (`apps/web/src/game/world-builder.ts`, `interior.ts`, `traffic.ts`) | Temporary | Procedural kit placed on OSM footprints and roads. Not presented as exact replicas of real buildings. |
| sign-atlas | Street blades, shop fascias, For Rent / For Sale boards, bus-stop flags, danfo destination boards | Rendered at runtime into one 2048² `DynamicTexture` | Final technique | Street names come only from OSM `name` tags; shop names are original fictional businesses. |
| lekki-osm | `world/lekki-phase1.world.json` | © OpenStreetMap contributors, ODbL 1.0 (see `data/osm/` and `world/LICENSE.md`) | Geography dataset | Derived from `data/osm/lekki-phase1-extract.osm.json` by `scripts/world/build-lekki.mjs`. |
| ikoyi-osm-20261010 | `world/ikoyi-starter.osm.json` | © OpenStreetMap contributors, ODbL 1.0 | Retained for the Ikoyi expansion | Not loaded by the current build. |
| ll-mark | Lagos Living interface mark and favicon | Original project vector | Final | |
| ui-fonts | System font stack | Browser/OS | Final | No external font requests. |

## Meshy usage

API access uses `MESHY_API_KEY` from the gitignored `apps/server/.env`; the key
is never sent to the browser or committed. `scripts/meshy/generate.mjs` records
every task in `docs/asset-generation-log.json` (signed URLs stripped).

| Task | Endpoint | Credits |
|---|---|---|
| resident-avatar preview | `/v2/text-to-3d` | 20 |
| danfo-shell preview | `/v2/text-to-3d` | 20 |
| resident-avatar refine | `/v2/text-to-3d` | 10 |
| danfo-shell refine | `/v2/text-to-3d` | 10 |
| resident-avatar rig | `/v1/rigging` | 5 |
| resident-avatar animations | `/v1/animations` | 30 |
| **Total** | | **95** |

Following the approval rule, only one avatar and one danfo were generated. The
street section is procedural, so no Meshy credits were spent on it. **No bulk
generation has been run.** Further avatars, vehicles or props need explicit
approval of a budget and retry limit.

Future additions must record the source URL, author, licence, required
attribution, generation prompt and settings, modification history, triangle
count, texture sizes, animation list, and temporary or final status before
integration.
